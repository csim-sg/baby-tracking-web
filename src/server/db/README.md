# Database module (schema, migrations, readiness)

Issue #23 · SPEC-002 §Data Model Changes · FR-14–FR-22, FR-35–FR-37, FR-41 ·
TR-09/TR-11/TR-13 · AC-04/AC-05/AC-06/AC-14/AC-15 · ADR-002 §6 · ARCH-002
canonical models and ownership.

## Contents

- `schema.ts` — Drizzle/PostgreSQL typed schema for the six application
  tables (`child_profile`, `sheet_template`, `day_log`, `care_entry`,
  `subscription`, `stripe_event`). Runtime query code imports this.
- `migrations/*.sql` — the committed SQL migrations applied by
  `npm run migrate` (schema of record; see "Two truths" below).
- `database-check.ts` / `register-database-check.ts` / `pool.ts` — the
  read-only `database` digital dependency check registered at server start
  and observed by `/readyz`.
- `auth-migration-config.ts` — minimal Better Auth 1.7.28 options used only
  by the migration runner for the auth-owned tables (built on the shared
  `src/server/auth/base-options.ts`). The runtime auth instance is
  `src/server/auth/instance.ts` (issue #24) and shares that builder, so the
  migrated table set cannot drift from the runtime options.

## Ownership

- **Auth-owned:** `user`, `session`, `account`, `verification` are created
  and altered ONLY by Better Auth's package-internal migration runner
  (`better-auth/db/migration` → `getMigrations(...)` → `runMigrations()`).
  No hand-written auth DDL exists in this repository, and no identity rows
  are stored in application tables.
- **Application-owned:** the six tables above are defined by the committed
  SQL migrations and mirrored in `schema.ts`. `user.id` (text) is the owner
  key. `care_entry` has no `user_id` — the owner is reached through
  `day_log`.
- There is deliberately **no migration-state table**: the schema itself is
  the migration state. The Better Auth runner re-introspects the catalog
  each run, and the application migrations are idempotent by construction
  (`IF NOT EXISTS` everywhere, constraints inside the guarded `CREATE
  TABLE`). A catalog probe (`to_regclass`) is how readiness verifies schema
  presence.

  **Disclosed exception (`rate_limit`, issue #24):** ADR-002 §1 control 2
  mandates a PostgreSQL-backed rate limiter in the same schema, and T1 F4
  proved the library limiter cannot run on this wiring. Migration
  `0002_rate_limit.sql` therefore adds ONE application-owned operational
  counter table — `rate_limit` (`key` = SHA-256 of action scope + IP/email
  identifier, `window_start`, `count`; no clear email/IP, no owner FK). It
  is in `REQUIRED_SCHEMA_TABLES` and the "exactly N tables" integration
  assertion, and its internal state must never appear in the FR-35 export
  (#28).

## The one-shot command: `npm run migrate`

Run as a separate deployment step BEFORE a new version is exposed, in both
modes. The application never migrates at startup, and the readiness check
never mutates the schema.

```
DATABASE_URL=postgres://… APP_URL=https://… npm run migrate
```

| Env            | Required | Purpose                                        |
| -------------- | -------- | ---------------------------------------------- |
| `DATABASE_URL` | yes      | Target PostgreSQL 16+. Never echoed to logs.   |
| `APP_URL`      | no       | Auth runner `baseURL` (does not affect DDL).   |

Fixed order, fail-fast (non-zero exit on any failure):

1. **Auth runner first** (application tables reference `user`). The runner
   diffs the live catalog against the library model and executes only the
   missing DDL, statement per statement. Per FR-41's "record what the runner
   actually does": Better Auth 1.7.28's `runMigrations()` does **not** wrap
   its statements in one transaction and keeps **no** journal table —
   idempotency comes from the catalog diff, so an interrupted run is
   completed by the next run.
2. **Application migrations** from `src/server/db/migrations/` in filename
   order. Each file runs inside ONE explicit transaction (`BEGIN` …
   `COMMIT`), so a failure rolls back that file completely — a failed run
   leaves no partial application schema (AC-15). Every statement is
   idempotent, so a re-run on a migrated database is a verified no-op.

PostgreSQL 16 executes each transactional DDL atomically; the combination
above satisfies FR-41 "transactional where PostgreSQL allows" with the
application schema fully transactional and the auth runner's behavior
recorded and idempotent.

## Forward-only and expand/contract

v1 has no previous schema; the upgrade-path evidence for this release is the
empty-database apply plus the idempotent re-run. Normal releases are
forward-only. Removing a column or table later uses expand/contract: first
release ships the expanded schema (old image still runs), a later release
contracts after the old image is retired, so rollback stays possible. Never
roll back by deleting user rows (ADR-002 §6).

## Adding a migration

1. Add `NNNN_description.sql` to `src/server/db/migrations/` (filename order
   is execution order). Keep it idempotent (`CREATE TABLE IF NOT EXISTS`,
   guarded `ALTER TABLE ... ADD CONSTRAINT` via `DO $$ ... $$`, `CREATE
   INDEX IF NOT EXISTS`), forward-only, and transactional as a whole.
2. Mirror any changed columns in `schema.ts`.
3. Extend `tests/integration/schema.test.ts` catalog assertions when
   constraints or indexes change.

## Readiness dependency (`database`)

`register-database-check.ts` registers `{ name: "database", modes: ["cloud",
"selfhost"] }` on the process-wide registry
(`globalThis.__toddlebook_digital_dependency_checks__`) when the handler
graph loads at server start — `/readyz` and the digital fail-closed gate
import it. The check:

- is **strictly read-only**: one bounded `SELECT to_regclass(...)` probe;
  no DDL, no writes, never a migration;
- is **bounded**: pool `connectionTimeoutMillis` 2000 ms and
  `statement_timeout` 2000 ms (`pool.ts`), so `/readyz` cannot hang;
- requires **schema presence**, not just connectivity: any missing table
  (six application + four auth-owned) reports `fail` (FR-41/TR-09);
- returns **sanitized** detail only: table names and generic failure
  classes — never the URL, host, user, password, driver error text, or care
  data.

Since issue #24 the `auth` (both modes) and `smtp` (cloud, config-derived)
checks are registered here too; `stripe` stays unregistered until #29, so a
launch-enabled cloud still reports 503 naming `stripe: uninitialized` while
a self-host instance with a valid configuration and migrated schema reaches
200 with `database` and `auth` ok.

## Packaging note (issue #37)

The current Dockerfile copies only `.output`; carrying the migration
command, its SQL assets, and the runtime dependencies inside the production
image is ADR-002 §6 packaging work owned by #37, not #23. #23's evidence
covers container-run execution from a clean checkout.

## Tests

- Unit: `tests/unit/database-check.test.ts` (probe outcomes, sanitization,
  registration idempotency; no database required).
- Integration: `tests/integration/schema.test.ts` — requires a disposable
  PostgreSQL 16 at `TEST_DATABASE_URL`; skipped when unset. Covers the real
  command's empty-database apply + no-op re-run, catalog introspection
  (columns, composite owner FKs, `ON DELETE SET NULL (template_id)`,
  uniques, check, indexes), two-account cross-owner rejection, template
  deletion preserving the snapshot, entry constraints, and deletion
  cascades.
- Built-server proof: `scripts/smoke/database-readiness.mjs` asserts the
  cold-start `/readyz` database entry, sanitization, and that `/` and
  `/healthz` stay 200 through reachable/failing/unreachable states.
