/**
 * Lazily created PostgreSQL pool for the digital `database` dependency
 * (issue #23; FR-40/FR-41). Server-side only — never imported by the `/`
 * render graph (enforced by tests/unit/import-boundary.test.ts).
 *
 * Bounds: `connectionTimeoutMillis` caps how long a /readyz probe can wait
 * for a connection and `statement_timeout` caps the probe statement, so a
 * down or unreachable database can delay readiness by a bounded few
 * seconds — it can never hang the request. The pool opens no connection
 * until first use (lazy initialization; `/` and `/healthz` never touch it).
 */

import { Pool } from "pg";

/** Time budget for obtaining a connection from the pool. */
export const CONNECTION_TIMEOUT_MS = 2000;

/** Server-side per-statement budget for the schema probe. */
export const STATEMENT_TIMEOUT_MS = 2000;

/** Small pool: this slice runs one bounded probe per readiness request. */
const POOL_MAX = 2;

type GlobalWithPool = typeof globalThis & {
  /** Process-wide lazily created pool, shared by every bundled copy. */
  __toddlebook_database_pool__?: Pool;
};

function globalPool(): Pool | undefined {
  return (globalThis as GlobalWithPool).__toddlebook_database_pool__;
}

/**
 * Returns the process-wide pool, creating it on first use. The globalThis
 * anchor mirrors the readiness-check registry: shared server modules can be
 * emitted into more than one server graph, and duplicate pools would defeat
 * the max-size bound.
 */
export function getDatabasePool(): Pool {
  const existing = globalPool();
  if (existing) {
    return existing;
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 5000,
  });
  // An error event on an idle client (e.g. the database going away) must
  // never crash the process: FR-01/TR-05 keep `/` serving through database
  // failures. The next readiness probe reports the failure instead.
  pool.on("error", () => {});
  (globalThis as GlobalWithPool).__toddlebook_database_pool__ = pool;
  return pool;
}
