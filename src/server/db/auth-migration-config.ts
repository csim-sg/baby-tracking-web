/**
 * Minimal Better Auth options for the AUTH-OWNED TABLES' migration runner
 * (issue #23; ADR-002 §1/§6: `user`, `session`, `account`, `verification`
 * are library-owned; their DDL is produced exclusively by Better Auth's
 * package-internal runner — `better-auth/db/migration` → `getMigrations(...)`
 * → `runMigrations()`, invoked first by `npm run migrate` because the
 * application tables reference `user`).
 *
 * RUNNER-ONLY by design (carry-forward #5/#8): this module must never grow
 * routes, handlers or session flows — the runtime auth instance is
 * `src/server/auth/instance.ts`. Both consumers spread the SAME
 * schema-relevant core from `src/server/auth/base-options.ts`, so the
 * migrated table set cannot drift from the runtime options; if the runtime
 * options ever change the migrated auth table set, `npm run migrate`
 * idempotency and the exactly-N-tables integration assertion must be
 * re-proven in the same change. Telemetry is disabled — self-host must not
 * phone home (FR-03/FR-42/AC-12).
 */

import type { BetterAuthOptions } from "better-auth";
// Explicit .ts extension: this module is loaded by `scripts/migrate.mjs`
// under Node's --experimental-strip-types, which resolves relative imports
// only with extensions (tsconfig allows importing TS extensions).
import { baseAuthOptions } from "../auth/base-options.ts";

/**
 * Builds the migration-runner options. `database` accepts the pg Pool the
 * runner should introspect and migrate (same shape the #18 spike proved).
 */
export function authMigrationOptions(
  database: BetterAuthOptions["database"],
): BetterAuthOptions {
  return baseAuthOptions(
    database as NonNullable<BetterAuthOptions["database"]>,
  );
}
