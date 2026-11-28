# FINDINGS — Auth library compatibility spike for ADR-002

**Issue:** [csim-sg/baby-tracking-web#18](https://github.com/csim-sg/baby-tracking-web/issues/18) — T1, SPEC-002, OD-05.
**Consumed by:** ADR-002 ([#20](https://github.com/csim-sg/baby-tracking-web/issues/20)).
**Status:** test-only spike; **no provider/auth selection is made here**. This document is evidence, not a decision.
**Spec authority:** SPEC-002 blob `e1c9cbd` on branch `docs/spec-002-baby-tracking-web` (OD-05, FR-05–FR-08, FR-41, AC-02, AC-19).

## 1. Question under test

Can the SPEC-002 recommended candidate (**Better Auth + PostgreSQL**) provide self-hostable email+password authentication on the application's current runtime — TanStack Start **1.169.7**, nitro **3.0.261103-rc** (Vite plugin, `node-server` preset), Vite **8.3.8**, React **19.3.1** — covering SSR/server-function session cookies, password hashing, verification/reset email callbacks over SMTP, CSRF/origin checks, rate limiting, sign-out/revocation, and PostgreSQL 16 migrations — without framework patching?

## 2. Exact versions under test

Runtime stack (pinned in `package.json`, mirrors resolved root versions):

| Package | Version |
|---|---|
| @tanstack/react-start | 1.169.7 |
| @tanstack/react-router | 1.170.46 |
| react / react-dom | 19.3.1 |
| vite | 8.3.8 |
| nitro | 3.0.261103-rc |
| h3 (transitive) | 2.0.8 |
| @vitejs/plugin-react | 5.2.0 |
| typescript | 5.9.3 |
| **better-auth (candidate)** | **1.7.28** |
| pg | 8.23.1 |
| nodemailer | 10.6.1 |

Node evidence runtime: **v22.23.5** (`node:22-bookworm`, sha256 `965a20a527d823076272e19fc95d3b74303f0e9dda1b0cfc99f22a11602ef564`) — same major as CI (`node-version: "22"`) and the production image (`node:22-alpine`). Full inventory: `results/versions.json`, `results/container-images.txt`.

Infrastructure: **PostgreSQL 16.16** (`postgres:16`, repo digest `ce811508…dc37a`) and **Mailpit** (`axllent/mailpit:latest`, repo digest `23a2ef85…c591a4e`) as ephemeral compose containers.

## 3. Results matrix

27 checks, **20 pass / 0 fail / 4 unsupported (documented) / 3 info**. Full structured data: `results/verify-results.json`.

| ID | Check | Result | SPEC refs |
|---|---|---|---|
| C01 | postgres:16 + Mailpit reachable | pass | FR-41 |
| C02 | Auth tables migrated (one-shot runner, PG 16.16) | pass | FR-41 |
| C03 | Sign-up persists user; no session while verification required; verification email sent | pass | FR-05/06/08 |
| C04 | Email normalization: mixed-case lowercased on storage; space-padded input rejected 400 (trim not applied) | info (finding F9) | FR-05 |
| C05 | Password stored hashed (scrypt, not plaintext) | pass | FR-05 |
| C06 | Password < 12 rejected | pass | FR-05 |
| C07 | Password > 128 rejected | pass | FR-05 |
| C08 | Duplicate-email response is generic (no existence disclosure) | pass | FR-05 |
| C09 | Sign-in blocked before email verification | pass | FR-06 |
| C10 | Verification callback verifies; auto-sign-in session issued | pass | FR-06 |
| C11 | Sign-in sets DB-backed session; expiry = 30 days | pass | FR-08 |
| C12 | Cookie attributes: `HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/` (Secure absent on http — expected) | info | FR-08 |
| C13 | **SSR reads DB-backed session from cookie inside a TanStack Start server function** | **pass** | FR-08, AC-02 |
| C14 | Wrong password rejected, no session issued | pass | FR-05 |
| C15 | Session refresh on activity (expiresAt/updatedAt advance) | pass | FR-08 |
| C16 | Sign-out revokes current session (cookie cleared, row deleted, SSR anonymous) | pass | FR-08 |
| C17 | Sign-out-all (`auth.api.revokeSessions`) revokes every session | pass | FR-08 |
| C18 | Revocation is DB-backed (row deletion invalidates cookie) | pass | FR-08 |
| C19 | Reset: SMTP email, single-use token, old password dead | pass | FR-07 |
| C19b | FR-07 pattern: reset + explicit `revokeSessions` | pass | FR-07 |
| C20 | Reset token replay rejected | pass | FR-07 |
| C21 | Reset-token TTL observed = 60 min (config `resetPasswordTokenExpiresIn: 3600`) | info | FR-06/07 |
| C23 | changePassword `revokeOtherSessions=true` — current session rotates, **other sessions survive** | **unsupported** (finding F5) | FR-08 |
| C23b | FR-08 pattern: changePassword + explicit `revokeSessions` | pass | FR-08 |
| C24 | Origin/CSRF rejection — **not enforced via programmatic `auth.api`** | **unsupported** (finding F4) | AC-02 |
| C25 | Rate limiting — **not enforced via programmatic `auth.api`** | **unsupported** (finding F4) | AC-02 |
| C26 | Raw HTTP mount of Better Auth handler — **not registered** by this Start/nitro wiring | **unsupported** (finding F4) | FR-08 |

## 4. Findings

### F1 — Core compatibility: WORKS (OD-05 primary question)
Better Auth 1.7.28 runs on TanStack Start 1.169.7 + nitro 3.0.261103-rc + Vite 8.3.8 with **no framework or library patching**. The harness builds with the root stack's exact versions and serves under nitro's `node-server` preset. Session cookies flow through TanStack Start **server functions** (`createServerFn` + `getRequest()` → `auth.api.getSession`) and **during SSR** (C13): the server-rendered page reflects the authenticated user from the DB-backed session. Sign-in/sign-out Set-Cookie values produced by Better Auth are applied to SSR responses via `setResponseHeader("Set-Cookie", …)` from the server-function context — the propagation works (C11/C16).

### F2 — PostgreSQL 16 migration: WORKS (FR-41 pattern)
The auth tables (`user`, `session`, `account`, `verification`) are created against PostgreSQL 16.16 by a **one-shot forward command** (`node --experimental-strip-types scripts/migrate.mjs`, ~0.3s) using better-auth's own `db/migration` runner — `getMigrations(authOptions).runMigrations()`. Re-runs are idempotent (empty plan). The app does not migrate at startup. This matches FR-41's "one-shot command before the new app version is exposed".

### F3 — The public `@better-auth/cli` is deprecated and unusable with 1.7.x
`@better-auth/cli@1.4.22` (latest stable; deprecation notice on npm) fails against a better-auth 1.7.28 config with `BetterAuthError: Failed to initialize database adapter`. Additionally, installing the CLI in the same package **breaks the application build**: its `@better-auth/core@1.4.22` hoists over 1.7.28's and Vite/rolldown fails with `"queueAfterTransactionHook" is not exported`. Consequence: the production migration command must drive better-auth's own migration runner (as the harness does) or use a newer CLI if better-auth ships one. Pin and verify pairing at the foundation slice.

### F4 — CSRF/origin checks and rate limiting are NOT enforceable on this wiring (main gap)
Better Auth enforces origin/CSRF validation (`validateOrigin`) and rate limiting **only in its HTTP router layer**. The programmatic `auth.api.*` surface used inside TanStack Start server functions **bypasses both** (reproduced: forged `Origin` with cookies passes; 30 rapid failed sign-ins produce zero 429s). The HTTP layer cannot be mounted on this stack:

- `@tanstack/react-start@1.169.7` exports **no API-route helper** (`@tanstack/react-start/api` does not exist; `createAPIFileRoute` is absent from the package).
- The `tanstackStart()` + `nitro({ preset: "node-server" })` wiring does **not scan** nitro-conventional `server/routes/**` or `src/server/routes/**` (both probed; `/api/auth/ok` 404s; retained probe: `server/routes/api/auth/[...slug].ts`).

Consequences for ADR-002: on this exact stack, cookie-CSRF protection, origin checks, and rate limiting need one of:
1. newer TanStack Start with API routes (verify version at implementation time),
2. explicit nitro configuration change to register handler files (verify with the nitro RC at implementation time),
3. an app-level guard (origin check middleware around auth-mutating server functions) + better-auth `rateLimit.storage: "database"`.

Rate-limit note: better-auth's **special rules override** configured `max` on auth paths (sign-in/sign-up/change-password: 3 per 10 s; password-reset: 3 per 60 s) and default `storage: "memory"` is single-instance only — multi-instance cloud deployments require database/redis storage.

### F5 — changePassword `revokeOtherSessions=true` does not revoke other sessions (bug-level)
Reproduced twice: the endpoint returns ok and **rotates the current session cookie**, but other sessions' rows survive (`deleteUserSessions` inside `runWithTransaction` does not persist with the built-in pg/Kysely adapter). Standalone `auth.api.revokeSessions` works correctly (0 rows after call). FR-08 requires "password changes MUST revoke all sessions" → the implementation must pair `changePassword` with an explicit `revokeSessions` + forced re-authentication (demonstrated in C23b), or pin/upgrade better-auth once the transactional behavior is fixed.

### F6 — resetPassword does not revoke existing sessions
FR-07 requires reset success to revoke existing sessions; better-auth 1.7.28's reset leaves pre-reset sessions valid (reproduced). Same remedy as F5: pair reset success with explicit `revokeSessions` (demonstrated in C19b). Reset tokens themselves are single-use with the configured 60-minute TTL (C20, C21 — `verification` row `expiresAt − createdAt = 1h`).

### F7 — Duplicate-email non-disclosure: satisfied by default in this configuration
With `requireEmailVerification: true` (or `autoSignIn: false`), better-auth returns a **generic duplicate response** (`ok`, `token: null`, synthetic user) and hashes the submitted password to blur timing — no existence disclosure (C08, FR-05).

### F8 — API drift vs older Better Auth documentation (implementation-slice checklist)
- `database` must be a pg `Pool` (Kysely-compatible); the documented-elsewhere `{ provider: "pg", url }` shape fails.
- `forgetPassword` → **`requestPasswordReset`**; reset URL delivers the token as a **path segment** (`/api/auth/reset-password/<token>?callbackURL=…`), not `?token=`.
- Sign-out-all → **`auth.api.revokeSessions()`**; legacy `signOut({ all: true })` body no longer exists.
- Reset email callback option: `sendResetPassword`; verification: `emailVerification.sendVerificationEmail` + `sendOnSignUp` + `autoSignInAfterVerification` (all exercised).

### F9 — Email normalization is partial
better-auth lowercases emails on storage (FR-05 "lowercased" ✓) but **rejects space-padded input with 400 `INVALID_EMAIL`** instead of trimming (C04). FR-05's "trimmed" must be applied at the app boundary before calling the auth API.

### F10 — Email verification/reset over SMTP: WORKS
Sign-up verification and password-reset emails are delivered through nodemailer SMTP (Mailpit capture) with actionable token URLs; `autoSignInAfterVerification` issues a session on verification; `requireEmailVerification` blocks unverified sign-ins (C09/C10). Self-host without SMTP is outside this spike's scope (FR-06 alternative path is operator-command recovery, T22/T7).

## 5. Unsupported cases (explicit, per issue AC)

1. **Origin/CSRF enforcement** — unavailable without an HTTP mount (F4).
2. **Rate limiting** — same (F4); plus memory-storage single-instance caveat.
3. **Raw HTTP mount of the Better Auth handler** — not possible on `@tanstack/react-start@1.169.7` + this nitro wiring (F4/C26).
4. **Password-change automatic revocation of other sessions** — broken in 1.7.28 (F5); compliant pattern demonstrated (C23b).

## 6. Fallback (self-hostable), if ADR-002 rejects Better Auth

All primitives required by a hand-rolled, self-hostable auth path were proven working in this runtime: DB-backed sessions in PostgreSQL 16 read from cookies inside SSR server functions, `HttpOnly`/`SameSite=Lax` cookie issuance and clearing from server functions, scrypt password hashing from `node:crypto` (Better Auth's default), SMTP callbacks via nodemailer, and one-shot forward migrations. A minimal fallback (email+password, sessions table, signed-token cookie, scrypt hashes, explicit origin check on mutations, app-level rate limiting against a Postgres table) would satisfy FR-05–FR-08 without any candidate library, at the cost of owning session-fixation/rotation and timing-hardening details that Better Auth provides.

## 7. Recommendation to ADR-002 (evidence summary, not a selection)

Better Auth 1.7.28 is **compatible with the current runtime for the core identity flows** (SSR/server-function sessions, hashing, verification/reset SMTP callbacks, PG16 migrations, duplicate-email non-disclosure) with **no framework patching**. Adopting it requires accepting and planning around four documented constraints: (a) migrate via the package-internal runner (CLI deprecated); (b) mount the HTTP handler for CSRF/origin + rate limiting (newer TanStack Start API routes or nitro wiring — to be verified in the foundation slice #24 or a small follow-up spike); (c) pair password-change/reset with explicit `revokeSessions`; (d) trim emails at the app boundary. If any of these is unacceptable, the fallback in §6 is viable. ADR-002 owns the decision.

## 8. Reproduction

```bash
cd scripts/spikes/auth-compat
bash scripts/run-all.sh        # infra → deps → migrate → build → serve → verify
```

Evidence files (committed): `results/verify-results.json`, `results/versions.json`, `results/container-images.txt`, `results/migration.log`, `results/migration.exit-code`, `results/build.log`, `results/server.log`, `results/compose-config.txt`. No secrets are committed; container credentials (`spiketest`) are ephemeral test-only values.
