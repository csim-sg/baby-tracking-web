/**
 * The digital `database` dependency check (issue #23; FR-40/FR-41/FR-43;
 * TR-09; ARCH-002 modes-and-readiness matrix).
 *
 * Contract enforced here:
 * - Strictly read-only: one bounded `to_regclass` catalog probe. No DDL, no
 *   writes, and no migration runs from the readiness path — schema presence
 *   is verified against the catalog, so a missing or partial schema fails
 *   readiness (FR-41: a failed or incomplete migration must leave digital
 *   readiness false).
 * - Bounded: the pool's connection and statement timeouts bound the probe;
 *   this check can delay /readyz by a few seconds, never hang it.
 * - Sanitized: the returned detail names table names and generic failure
 *   classes only. It must never contain the connection URL, host, user,
 *   password, driver error text, or any care data.
 * - Modes: cloud and self-host — one PostgreSQL schema serves both.
 */

import type { PoolClient } from "pg";
import type { DependencyCheck } from "../readiness";
import {
  CONNECTION_TIMEOUT_MS,
  getDatabasePool,
  STATEMENT_TIMEOUT_MS,
} from "./pool";

/**
 * Every table `npm run migrate` must leave behind: the six SPEC application
 * tables, the four auth-owned tables, and the ADR-002-mandated rate-limit
 * counter table (#24; the one disclosed exception to "no tables outside the
 * SPEC set"). Connectivity alone is not readiness — a database missing any
 * of these reports `fail` with the missing names (sanitized; table names are
 * public in the repository).
 */
export const REQUIRED_SCHEMA_TABLES = [
  // Auth-owned (Better Auth migration runner).
  "user",
  "session",
  "account",
  "verification",
  // Application (Drizzle-managed migrations).
  "child_profile",
  "sheet_template",
  "day_log",
  "care_entry",
  "subscription",
  "stripe_event",
  // Application-owned operational table (ADR-002 §1 control 2; issue #24).
  "rate_limit",
] as const;

/** Minimal query surface used by the probe (satisfied by a pg client). */
export type DatabaseExecutor = {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type DatabaseProbeResult = {
  ok: boolean;
  detail: string;
  /** Names from REQUIRED_SCHEMA_TABLES absent from the catalog. */
  missing: string[];
};

/**
 * Runs the read-only schema-presence probe on a connected executor.
 * Exported for unit tests with a fake executor; the dependency check wraps
 * it with the real bounded pool.
 */
export async function probeDatabaseSchema(
  executor: DatabaseExecutor,
): Promise<DatabaseProbeResult> {
  const columns = REQUIRED_SCHEMA_TABLES.map(
    (_, position) => `to_regclass($${position + 1}) AS t${position}`,
  ).join(", ");
  const values = REQUIRED_SCHEMA_TABLES.map((table) => `public.${table}`);
  const result = await executor.query(`SELECT ${columns}`, values);
  const row = result.rows[0] ?? {};
  const missing: string[] = [];
  REQUIRED_SCHEMA_TABLES.forEach((table, position) => {
    if (row[`t${position}`] === null || row[`t${position}`] === undefined) {
      missing.push(table);
    }
  });
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `database schema incomplete: missing tables: ${missing.join(", ")}`,
      missing,
    };
  }
  return {
    ok: true,
    detail: "database reachable; schema present",
    missing,
  };
}

export function createDatabaseDependencyCheck(): DependencyCheck {
  return {
    name: "database",
    modes: ["cloud", "selfhost"],
    run: async () => {
      const url = process.env.DATABASE_URL;
      if (url === undefined || url.trim() === "") {
        return { ok: false, detail: "DATABASE_URL not set" };
      }
      // Bounded by the pool's connectionTimeoutMillis (see ./pool.ts).
      let client: PoolClient;
      try {
        client = await getDatabasePool().connect();
      } catch {
        return { ok: false, detail: "database connection failed" };
      }
      try {
        // Bounded by the pool's statement_timeout; the client is released in
        // finally so the small pool stays available for the next request.
        const probe = await probeDatabaseSchema({
          query: (sql, values) => client.query(sql, values),
        });
        return { ok: probe.ok, detail: probe.detail };
      } catch {
        return { ok: false, detail: "database schema probe failed" };
      } finally {
        client.release();
      }
    },
  };
}

/**
 * The readiness-registered database check instance (idempotently registered
 * at server start by ./register-database-check.ts).
 */
export const databaseDependencyCheck: DependencyCheck =
  createDatabaseDependencyCheck();

export { CONNECTION_TIMEOUT_MS, STATEMENT_TIMEOUT_MS };
