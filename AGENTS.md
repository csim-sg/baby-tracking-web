# Agent Guidance

## Repository Identity

This repository is `csim-sg/baby-tracking-web`. Toddlebook is a printable 24-hour child-care log. The current product is a browser-based sheet configurator and print view. The founder-approved [SPEC-002](https://github.com/Antpolis/documentation/blob/docs/spec-002-baby-tracking-web/02-Architecture-Landscape/projects/baby-tracking-web/SPEC-002-cloud-and-self-hosted-digital-care-logs.md) adds optional owner-only digital care logs, history, saved sheet-setting templates, filled-log browser printing, a cloud subscription, and an equivalent self-hosted deployment. That work is specified and architected but **not implemented** here: [ARCH-002](https://github.com/Antpolis/documentation/blob/docs/spec-002-baby-tracking-web/02-Architecture-Landscape/projects/baby-tracking-web/architecture/ARCH-002-digital-care-log-target-architecture.md) is the target architecture and [ADR-002](https://github.com/Antpolis/documentation/blob/docs/spec-002-baby-tracking-web/02-Architecture-Landscape/projects/baby-tracking-web/architecture/ADR-002-cloud-self-host-auth-persistence-billing.md) records the technical decisions. Spreadsheet export, caregiver/household sharing, doctor-review reporting, native apps, offline/sync, and server-side PDF remain out of scope.

## Project Structure

- `src/routes/index.tsx` contains the sheet configuration, preview, and print action.
- `src/routes/__root.tsx`, `src/main.tsx`, `src/router.tsx`, and `src/ssr.tsx` are the TanStack Start and router entry points.
- `src/styles/app.css` contains the Tailwind-managed application and print styles.
- `src/server/` holds the SPEC-002 server foundation: runtime mode configuration and the digital readiness state (`runtime-config.ts`, `readiness.ts`, `server-flags.ts`, `digital-gate.ts`, `handlers/` — root-level `/healthz` and `/readyz` plus the fail-closed digital gate; issue #22), and `src/server/db/` — the Drizzle/PostgreSQL schema, committed SQL migrations, the one-shot `npm run migrate` command (`scripts/migrate.mjs`), and the read-only `database` readiness check (issue #23). See `src/server/db/README.md` for migration ownership and semantics.
- `scripts/parity/` contains the committed styling/print parity harness and baseline; `scripts/smoke/` contains built-server smoke scripts; `scripts/spikes/auth-compat/` retains the test-only auth compatibility evidence for ADR-002.
- `vite.config.ts` configures the Vite/TanStack Start build and Nitro Node server output.
- `Dockerfile`, `compose.yaml`, and `compose.prod.yaml` define the container build, local Compose runtime, and production Traefik overlay.

SPEC-002 modules still planned (not present at `main`): `src/routes/app/*`, `src/routes/api/*`, `src/domain/sheet-config`, and `src/server/{auth,billing,care}` (auth wiring, billing composition, care services; issues #24+). See ARCH-002 for the target boundaries; do not describe planned modules as current.

## Architecture And Runtime

TanStack Start renders the application with SSR. Sheet configuration is held in browser-side React state; there is no login and no server-side sheet processing, and no route reads or writes the database yet. The server computes the deployment mode and digital-readiness state from `DEPLOYMENT_MODE=cloud|selfhost` and `CLOUD_APP_ENABLED`, serves root-level `/healthz` (liveness, database-free) and `/readyz` (digital readiness), and fails the digital surface (`/app`, auth pages, `/api/auth/*`, `/api/stripe/webhook`) closed. `/readyz` observes a registered, read-only, bounded `database` dependency check (connectivity plus schema presence); the app never migrates at startup. The GTM script loads on cloud `/` only (no consent gate). Printing uses the browser print dialog. The production build emits Nitro output, and the container starts `node .output/server/index.mjs` on port 3000.

**Target architecture (SPEC-002) is partially implemented.** ARCH-002 defines a modular monolith: one TanStack Start/Nitro application plus one PostgreSQL 16+ schema, with `/` free of digital imports, `/app` routes, an immutable log snapshot for filled print, self-hostable Better Auth sessions, and cloud-only Stripe composition. At `main`, the foundation (modes, readiness, fail-closed gates), the database schema and migrations, and the `database` readiness check exist; auth wiring, billing, care services, `/app` routes, and self-host packaging do not (issues #24+).

## Commands

- `npm run dev` starts the development server.
- `npm run build` creates the production build.
- `npm run start` starts the built Nitro server.
- `npm run format` formats the source files.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm test` runs the Vitest suite. Unit tests under `tests/unit/` need no services; schema integration tests under `tests/integration/` require a disposable PostgreSQL 16 (`TEST_DATABASE_URL`) and skip when it is unset.
- `npm run migrate` is the one-shot migration command (FR-41): it runs the Better Auth 1.7.28 migration runner for the auth-owned tables first, then the committed SQL migrations for the application tables. Forward-only, transactional per application migration file, idempotent on re-run, fail-fast non-zero. The app never migrates at startup; see `src/server/db/README.md`.
- `npm run parity:verify` verifies the served production build against the committed styling baseline. Build and serve the production build first (`npm run build && npm run start`), then run it with `BASE_URL` pointing at that server (see `scripts/parity/README.md`).
- `npm run parity:capture` captures a parity baseline document. Widening a tolerance or recapturing the committed baseline to make a run pass is a specification change, not a fix.

The styling parity harness under `scripts/parity/` guards visual and print equivalence against the committed baseline (`scripts/parity/baseline/baseline.json`). GitHub Actions CI runs `npm ci`, build, parity verify, and container build; production deployment runs only after successful CI on `main` and only when `DEPLOY_ENABLED=true` (see `README.md` and `.github/workflows/deploy.yaml`). CI does **not** run `npm run typecheck` or `npm test` — those are builder/reviewer evidence until issue #35 wires them into CI. An operator password-reset command does not exist yet (issue #24+); do not assume one does.

## Delivery Workflow

1. Start with the assigned GitHub issue and its `Durable Context` URLs.
2. Treat linked SPEC, ARCH, ADR, GOV, and runbook notes as durable authority. Do not infer a design for planned capabilities from this repository's current implementation.
3. Use GitHub for issue status, ownership, handoffs, blockers, review, and approval.
4. Use `/Users/chrissim/.agents/scripts/gh_project_helper.sh` for GitHub workflow operations. It loads this repository's `.github-project.env` itself.
5. The configured GitHub repository is `csim-sg/baby-tracking-web`, and the project board is #4. Board workflow operations use its canonical `Workflow State` field.
6. Durable project documentation lives at `/Users/chrissim/Projects/Docs/02-Architecture-Landscape/projects/baby-tracking-web`. Start with `PROJECT_OVERVIEW.md` and follow its linked architecture and project-structure notes. ARCH-001 is current state only; ARCH-002 is the SPEC-002 target. The SPEC-002/ARCH-002/ADR-002 records currently live on the `docs/spec-002-baby-tracking-web` branch, so use the branch-pinned links from the issue until they are merged to `master`.

## Project Configuration

`.github-project.env` is the committed source of shared `ANT_TEAM_*` project configuration; it contains project metadata, not secrets. The current values are listed below so agents can use this guidance without reopening the environment file. If this section and `.github-project.env` ever disagree, the environment file is authoritative. Edit values there when repository routing or project metadata changes; re-running the initialization script preserves existing values and only fills missing keys.

```sh
export ANT_TEAM_GITHUB_OWNER='csim-sg'
export ANT_TEAM_GITHUB_OWNER_TYPE='user'
export ANT_TEAM_GITHUB_REPO='csim-sg/baby-tracking-web'
export ANT_TEAM_GITHUB_PROJECT_NUMBER='4'
export ANT_TEAM_GITHUB_PROJECT_ID='PVT_kwHOAB4wV84Bsm_Z'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_FIELD_ID='PVTSSF_lAHOAB4wV84Bsm_Zzhq0Y40'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_OPEN_ID='b30bed6e'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_BACKLOG_ID='c95492c4'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_NEED_ATTENTIONS_ID='abeb1bc3'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_READY_ID='1b3787af'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_IN_PROGRESS_ID='994af751'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_IN_REVIEW_ID='fc73eb98'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_READY_TO_MERGE_ID='f6fb9016'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_BLOCKED_ID='fe1cab88'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_DONE_ID='5563f588'
export ANT_TEAM_WORKTREE_ROOT='/Users/chrissim/Projects/worktree/baby-tracker'
export ANT_TEAM_DOCS_VAULT_PATH='/Users/chrissim/Projects/Docs'
export ANT_TEAM_DOCS_PROJECT_NAME='baby-tracking-web'
export ANT_TEAM_DOCS_REPOSITORY='Antpolis/documentation'
export ANT_TEAM_DOCS_PROJECT_PATH='/Users/chrissim/Projects/Docs/02-Architecture-Landscape/projects/baby-tracking-web'
```

`ANT_TEAM_GITHUB_WORKFLOW_STATE_FIELD_ID` identifies Project #4's canonical `Workflow State` field; the built-in `Status` field is separate and unchanged. The option-ID variables map to the states `Open`, `Backlog`, `Need attentions`, `Ready`, `In Progress`, `In Review`, `Ready to Merge`, `Blocked`, and `Done`, respectively. Use `/Users/chrissim/.agents/scripts/gh_project_helper.sh` for board operations; it loads `.github-project.env` itself and resolves these IDs. To expose all values in a direct shell session, run `source .github-project.env`.

## Change Guidance

Keep sheet configuration and print behavior aligned between the interactive preview and printed A4 landscape output. Do not add server persistence, paid account behavior, spreadsheet integrations, or mobile architecture outside an approved requirement and recorded durable context (SPEC-002, ARCH-002, ADR-002, and later issue evidence). Follow ARCH-002's module boundaries: `/` imports no database, auth, billing, or `/app` server module; care services import no Stripe, subscription state, or deployment mode; one PostgreSQL schema and one auth path serve both modes; no native/offline/sync/sharing scope; preserve the committed `/` parity baseline and the ADR-001 styling/print convention.
