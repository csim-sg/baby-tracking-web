/**
 * Minimal Better Auth options for the AUTH-OWNED TABLES' migration runner
 * (issue #23; ADR-002 §1/§6: `user`, `session`, `account`, `verification`
 * are library-owned; their DDL is produced exclusively by Better Auth's
 * package-internal runner — `better-auth/db/migration` → `getMigrations(...)`
 * → `runMigrations()`, invoked first by `npm run migrate` because the
 * application tables reference `user`).
 *
 * This module is NOT the runtime auth instance: no routes, handlers or
 * session flows are wired here (issue #24 owns auth lifecycle wiring and may
 * extend or supersede this configuration). The options mirror the FR-05–FR-08
 * knobs the #18 compatibility spike proved so the migrated table set matches
 * the intended runtime shape (password 12–128, 30-day sessions). Telemetry is
 * disabled — self-host must not phone home (FR-03/FR-42/AC-12).
 */

import type { BetterAuthOptions } from "better-auth";

/**
 * Builds the migration-runner options. `database` accepts the pg Pool the
 * runner should introspect and migrate (same shape the #18 spike proved).
 */
export function authMigrationOptions(
  database: BetterAuthOptions["database"],
): BetterAuthOptions {
  return {
    appName: "toddlebook",
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:3000",
    database,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}
