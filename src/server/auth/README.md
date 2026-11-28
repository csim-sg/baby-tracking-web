# Auth module (identity lifecycle, sessions, `/app` shell)

Issue #24 · SPEC-002 §Identity and account lifecycle (FR-05–FR-09, FR-11/
FR-12, FR-22, FR-36, FR-38) · TR-10/TR-12/TR-13/TR-14 · AC-02/AC-03/AC-04 ·
ADR-002 §1 (Better Auth 1.7.28 + the four mandatory application-boundary
controls) · ARCH-002 components and boundaries.

## Contents

- `base-options.ts` — the shared, schema-relevant Better Auth options core.
  BOTH consumers spread it, so the migrated auth table set cannot drift from
  the runtime instance (guarded by tests/unit/auth-options.test.ts):
  - `../db/auth-migration-config.ts` (the `npm run migrate` runner, which
    stays runner-only), and
  - `instance.ts` (the runtime auth instance, which adds only behavior
    knobs: verification callbacks, token lifetimes, cookie attributes).
- `instance.ts` — the runtime Better Auth 1.7.28 instance, lazily created on
  first digital use and anchored on `globalThis.__toddlebook_auth_instance__`
  (one instance per process; never imported by the `/` render path).
- `origin.ts` — the application-boundary same-origin guard for every non-GET
  server function (ADR-002 §1 control 1; T1 F4 proved the library's HTTP
  router — and its own origin/CSRF checks — cannot be mounted on this stack).
- `rate-limit.ts` — the PostgreSQL-backed rate limiter (ADR-002 §1 control 2)
  over the `rate_limit` counter table (migration `0002_rate_limit.sql`):
  SHA-256 hashed keys (`scope:identifier`), fixed windows, atomic upsert,
  fails CLOSED when the store errors, per-IP and per-identifier/action limits
  for sign-up, sign-in, password reset, verification resend, and password
  change. The state survives instance replacement by construction (every
  consume round-trips PostgreSQL — TR-10).
- `guard.ts` — server-function guards: readiness gate
  (`throwUnlessSurfaceReady`), `guardMutation()` (readiness → same-origin →
  64 KB body bound), rate-limit envelope (429 + Retry-After), and
  `revokeAllSessionsForUser` (SPEC-sanctioned revocation by user ID).
- `session.ts` — nothing; session reads go through `fns.ts` helpers.
- `fns.ts` — the auth server functions (the ONLY auth transport; `/api/auth/*`
  stays nitro-gated because no real endpoint exists on this stack): sign-up,
  sign-in, sign-out, sign-out-all, forgot/reset password, change password,
  verify email, resend verification, plus the page gate/session readers.
- `register-checks.ts` — server-start registration of the `auth` (both
  modes) and `smtp` (cloud, config-derived — never a network probe) readiness
  checks on the process-wide `globalThis` registry.
- `mailer.ts` — nodemailer SMTP transport from `SMTP_HOST/PORT/USER/PASSWORD`
  (optional in self-host); verification and reset mail only, never care data.
- `../care/children.ts` + `../care/children-fns.ts` — the owner-scoped child
  profile service (nickname-only, 1–40 chars, max 10 per account, foreign
  IDs → NOT_FOUND, delete requires the exact nickname retyped; database
  cascades logs/entries on delete).

## Identity flows (FR-05–FR-08)

- Sign-up: email trimmed + lowercased at the boundary (T1 F9 — the library
  rejects padded input), password 12–128 (library-enforced), and the response
  is mode-uniform: in verification modes the library's own generic duplicate
  response (T1 F7) is passed through; in no-verification modes duplicates map
  to the SAME "ready — sign in" shape a new account gets. Account existence
  is never disclosed.
- Email verification (FR-06): required whenever SMTP settings are present —
  always in cloud (runtime-config enforces them), in self-host when the
  operator configured SMTP. Links expire after 24 hours; the mail rewrites
  the library URL (which points at the gated, never-mounted `/api/auth/*`)
  into the app's own `/verify-email?token=…` page. Resends are rate-limited.
- Password reset (FR-07): single-use token valid 60 minutes; success revokes
  every session of the user (T1 F6 pairing — the library's reset leaves
  sessions alive, so the app revokes by user ID; the token→user mapping reads
  the library's `verification` row, `identifier = "reset-password:<token>"`).
- Password change (FR-08): `changePassword` + explicit `revokeSessions`
  (T1 F5 — the `revokeOtherSessions` flag does not reliably revoke in
  1.7.28); the caller is signed out everywhere and must re-authenticate.
- Sessions: database-backed, `HttpOnly` + `SameSite=Lax` + `Path=/` cookies,
  `Secure` whenever `APP_URL` is HTTPS (verified in the E2E evidence), 30-day
  expiry with library refresh-on-activity. Sign-out deletes the row and
  clears the cookie; sign-out-all (`revokeSessions`) leaves zero rows.
- Rate limits: 429 + `Retry-After` from the PostgreSQL limiter; per-IP and
  per-email/action budgets are independent (see `RATE_LIMIT_POLICIES`).

## `/app` surface and the fail-closed gate

The `vite.config.ts` nitro entries for `/app` (+ subtree) and the auth pages
were replaced by real SSR routes. Their fail-closed contract is carried by
`src/server/handlers/digital-gate-middleware.ts` — a nitro MIDDLEWARE
handler (`middleware: true`, route `/**`) that runs before the framework
renderer: 503 naming the failure while the digital surface is not ready, 404
when `CLOUD_APP_ENABLED=false`, 404 JSON for unknown digital subpaths, and a
302 to `/sign-in` (local return path) for `/app` without a session. The
statuses must be produced before the renderer because nitro's renderer
streams only the SSR response body — this is also why `vite.config.ts` sets
`renderer: false` (the repo-root `index.html` artifact otherwise selects
nitro's generic renderer template, which strips every SSR response's status
and headers). `/` and the server-function RPC namespace are untouched by the
middleware; every auth/care server function re-gates itself, so a direct RPC
call cannot bypass anything.

## Self-host without SMTP (FR-06/FR-09; AC-03)

Without SMTP settings, email verification is DISABLED — sign-up completes
without verification and the sign-up page states the limitation. Password
recovery is the operator-only reset command; self-service reset cannot send
mail and says so (without disclosing account existence).

### Operator reset command

```
npm run reset-password -- <email> <new-password>
# or, to keep the password out of shell history:
RESET_EMAIL=<email> RESET_PASSWORD=<password> npm run reset-password
```

Requires `DATABASE_URL` and shell/database access. In ONE transaction it
hashes the new password with the library's own scrypt
(`better-auth/crypto#hashPassword` — the exact default
`context.password.hash` resolves to), updates the credential `account` row,
and deletes every `session` row for the user. It is a committed script
(`scripts/reset-password.mjs`) — NOT an HTTP surface: no route, handler, or
server function exposes it, and it is not part of the built server output
(`scripts/` is not copied into `.output`). Cloud operators use it only as a
documented break-glass procedure. Image packaging of the command is issue
#37 (ADR-002 §6).

## Trusted proxies and client IPs

The rate limiter's per-IP budget uses the first `X-Forwarded-For` entry when
present, otherwise the direct peer address. Deployments run behind a proxy
that owns this header (self-host docs must state the requirement — SPEC
§Security); a deployment that lets clients set `X-Forwarded-For` directly
weakens the per-IP budget (the per-email budgets remain).

## Tests

- Unit: `tests/unit/auth-email.test.ts` (trim/lowercase, local-return
  allowlist), `tests/unit/auth-origin.test.ts` (origin allowlist),
  `tests/unit/auth-options.test.ts` (runtime/migration option parity — the
  carry-forward #8 guardrail — plus FR-05–FR-08 knobs and the cookie
  contract), `tests/unit/auth-values.test.ts` (nickname bounds, hashed
  limiter keys).
- Integration (disposable PostgreSQL 16 at `TEST_DATABASE_URL`; must RUN, not
  skip, in builder evidence): `tests/integration/auth-children.test.ts`
  (sign-up/session shape/cookie flags, password bounds, duplicate-email
  error shape, F5 and F6 revocation pairings, revoke-by-user-ID, guard
  fail-closed, child CRUD + cap + foreign-id 404 + cascade),
  `tests/integration/rate-limit.test.ts` (limits, hashed keys, window reset,
  PROCESS-RESTART persistence through a second pool, pruning, fail-closed),
  `tests/integration/schema.test.ts` (exactly the required tables incl.
  `rate_limit`).
- E2E (`scripts/e2e/auth-lifecycle.mjs`, production build on a free port):
  `--phase identity` (full lifecycle over Mailpit SMTP — verification mail,
  duplicate-email non-disclosure, cookie flags, gating/redirects, GTM
  absence, origin/CSRF rejection over the real RPC endpoint, 429s, reset +
  revocation, password change, sign-out-all, child CRUD/cap/confirmation,
  cross-account isolation), `--phase nosmtp` (AC-03: starts, signs up
  unverified with the limitation notice, operator reset command works and is
  not HTTP-reachable), `--phase secure-cookie` (browser over the https
  APP_URL origin: captured Set-Cookie carries `Secure`).
