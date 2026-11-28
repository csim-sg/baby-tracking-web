# auth-compat-spike (test-only)

Compatibility spike for **Better Auth 1.7.28** on the application's current runtime — **TanStack Start 1.169.7 / nitro 3.0.261103-rc / vite 8.3.8 / React 19.3.1** — producing retained, reproducible evidence for **ADR-002** (issue #18, SPEC-002 OD-05).

This directory is **test-only and isolated**: it has its own `package.json`/lockfile, never touches the application runtime, `src/`, root dependencies, migrations, deployment, or the parity baseline. It demonstrates candidate behavior; it is **not** the selected production auth implementation. ADR-002 (#20) owns the decision.

## What is verified

A 27-check matrix (C01–C26) covering SPEC-002 OD-05 / AC-02 / FR-05 / FR-06 / FR-07 / FR-08 / FR-41:

- one-shot auth-table migration against **PostgreSQL 16** (`FR-41`)
- sign-up, sign-in, email verification over SMTP (Mailpit), password reset (`FR-05`–`FR-07`)
- password hashing, password policy, duplicate-email response shape (`FR-05`)
- DB-backed sessions: cookie attributes, 30-day expiry, refresh on activity, sign-out, sign-out-all, revocation (`FR-08`)
- SSR session reads inside a TanStack Start **server function** (`AC-02`, `FR-08`)
- password change + session revocation (`FR-08`)
- origin/CSRF and rate-limit behavior — **documented as unsupported through the programmatic surface** (see findings)
- raw HTTP mount of the Better Auth handler — **not available** in this TanStack Start wiring (recorded)

Final results: **20 pass / 0 fail / 4 unsupported (documented findings) / 3 info** — see `results/verify-results.json` and `results/FINDINGS.md`.

## How to run (clean checkout)

Requirements: Docker (compose v2), Node >= 22.6 on PATH (the harness runs inside a `node:22-bookworm` container in the default mode, matching CI's Node 22).

```bash
cd scripts/spikes/auth-compat
bash scripts/run-all.sh
```

`run-all.sh`:

1. starts ephemeral `postgres:16` + `axllent/mailpit` containers (`docker-compose.yaml`, credentials `spiketest` are throwaway test-only values; ports bound to 127.0.0.1 when local)
2. installs harness dependencies with `npm ci --ignore-scripts` (isolated package; no lifecycle scripts)
3. records exact toolchain versions (`results/versions.json`) and image digests (`results/container-images.txt`)
4. applies the one-shot auth-table migration via better-auth 1.7.28's own migration runner (`results/migration.log`)
5. builds the harness app with the exact root-stack versions (`vite build`, nitro `node-server` preset)
6. serves it on `http://127.0.0.1:3300`
7. runs the verification matrix (`results/verify-results.json` + console log)

Two execution modes are auto-detected: **local** (published ports reachable on 127.0.0.1) and **container** (everything runs inside the compose network through a `node:22-bookworm` `runner` service — used for remote Docker daemons and to keep the evidence on Node 22). Both produce identical evidence; the recorded evidence in `results/` was produced in container mode with Node v22.23.5 (image digest in `results/container-images.txt`).

## Notable version findings (do not miss these in ADR-002)

- `@better-auth/cli` is **deprecated at 1.4.x** and cannot drive better-auth 1.7.x ("Failed to initialize database adapter"); installing it in the same tree also breaks bundling (`@better-auth/core` version shadowing). The harness therefore migrates via better-auth's own `db/migration` export (`scripts/migrate.mjs`), which pairs exactly with the runtime version.
- better-auth 1.7.28 expects `database` to be a pg `Pool` (Kysely-compatible) — the older `{ provider: "pg", url }` shape fails ("Only kysely adapter is supported for migrations").
- API renames vs older docs: `forgetPassword` → `requestPasswordReset`; sign-out-all → `auth.api.revokeSessions()` (legacy `signOut { all: true }` body no longer exists).
- `@tanstack/react-start@1.169.7` has **no API-route surface** (`@tanstack/react-start/api` does not exist; nitro `server/routes/**` is not scanned by the `tanstackStart()` + `nitro({ preset: "node-server" })` wiring), so Better Auth's HTTP-layer middleware (CSRF/origin validation, rate limiting) is not enforceable without newer Start versions or extra nitro wiring. The retained probe is `server/routes/api/auth/[...slug].ts`.

Full findings, unsupported cases, fallback and recommendation: **`results/FINDINGS.md`**.
