/**
 * The shared Better Auth options core (issue #24; ADR-002 §1).
 *
 * BOTH consumers must use this builder so the migrated auth table set can
 * never drift from the runtime instance:
 * - `src/server/db/auth-migration-config.ts` (the `npm run migrate` runner,
 *   which must stay runner-only) spreads it as-is, and
 * - `src/server/auth/instance.ts` (the runtime auth instance) spreads it and
 *   adds only behavior knobs that cannot change the schema (verification
 *   callbacks, cookie attributes, token lifetimes).
 *
 * Everything here maps to the FR-05–FR-08 knobs the #18 spike proved:
 * password length 12–128, 30-day database-backed sessions. Telemetry is
 * disabled — self-host must not phone home (FR-03/FR-42/AC-12).
 */

import type { BetterAuthOptions } from "better-auth";

export const APP_NAME = "toddlebook";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** FR-08: 30 days of inactivity. */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;

/** FR-06: verification links expire after 24 hours. */
export const VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60 * 24;

/** FR-07: reset tokens are single-use and valid for 60 minutes. */
export const RESET_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

/**
 * Builds the shared, schema-relevant options. `database` accepts the pg Pool
 * the library should use (the #18 spike proved the plain-Pool shape; the
 * `{ provider: "pg", url }` shape documented elsewhere fails).
 */
export function baseAuthOptions(
  database: NonNullable<BetterAuthOptions["database"]>,
): BetterAuthOptions {
  return {
    appName: APP_NAME,
    database,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}
