/**
 * PostgreSQL-backed rate limiter (issue #24; ADR-002 §1 control 2; FR-05–
 * FR-07 "rate-limited"; SPEC §Security "Auth endpoints are rate-limited per
 * IP and per email").
 *
 * T1 F4 proved Better Auth's limiter runs only inside its unmountable HTTP
 * router with single-instance memory storage, so the limiter lives HERE:
 * a fixed-window counter table in the SAME PostgreSQL schema, keyed by
 * action + hashed identifier.
 *
 * Storage contract (tech-lead-approved shape, carry-forward #6):
 * - keys are SHA-256 hashes of `scope:identifier` — no email or IP is ever
 *   stored in clear, and the table has no owner foreign key;
 * - one row per key holds the window start and count;
 * - counters survive instance replacement because every consume() round-
 *   trips PostgreSQL (no in-process state — TR-10).
 *
 * `consume()` is a single atomic upsert, so concurrent requests cannot
 * exceed the limit by racing the read and the write.
 */

import { createHash } from "node:crypto";
import type { Pool } from "pg";

/** The table added by src/server/db/migrations/0002_rate_limit.sql. */
export const RATE_LIMIT_TABLE = "rate_limit";

/** SHA-256 `scope:identifier` — the only stored representation. */
export function rateLimitKey(scope: string, identifier: string): string {
  return createHash("sha256").update(`${scope}:${identifier}`).digest("hex");
}

export type ConsumeResult = {
  /** False when the call exceeds the limit and must be rejected. */
  allowed: boolean;
  /** Count recorded for this window (including this call). */
  count: number;
  /** Seconds until the current window ends (for Retry-After). */
  retryAfterSeconds: number;
};

/** Executor surface (satisfied by a pg client/pool). */
export type RateLimitExecutor = {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
};

/**
 * Atomic fixed-window consume. The window resets by rewriting the row when
 * `window_start + windowSeconds` has passed; otherwise the count increments.
 */
export async function consumeWithExecutor(
  executor: RateLimitExecutor,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<ConsumeResult> {
  const key = rateLimitKey(scope, identifier);
  let row: Record<string, unknown> | undefined;
  try {
    const result = await executor.query(
      `INSERT INTO "${RATE_LIMIT_TABLE}" ("key", "window_start", "count")
       VALUES ($1, now(), 1)
       ON CONFLICT ("key") DO UPDATE SET
         "count" = CASE
           WHEN "${RATE_LIMIT_TABLE}"."window_start" + make_interval(secs => $2::double precision) <= now()
           THEN 1
           ELSE "${RATE_LIMIT_TABLE}"."count" + 1
         END,
         "window_start" = CASE
           WHEN "${RATE_LIMIT_TABLE}"."window_start" + make_interval(secs => $2::double precision) <= now()
           THEN now()
           ELSE "${RATE_LIMIT_TABLE}"."window_start"
         END
       RETURNING "count", "window_start"`,
      [key, windowSeconds],
    );
    row = result.rows[0];
  } catch {
    // The counter table is unreachable (missing migration, database down):
    // FAIL CLOSED — a limiter outage must never disable the limit.
    return { allowed: false, count: 0, retryAfterSeconds: windowSeconds };
  }
  if (!row) {
    return { allowed: false, count: 0, retryAfterSeconds: windowSeconds };
  }
  const count = Number(row.count ?? 0);
  const windowStart =
    row.window_start instanceof Date
      ? row.window_start
      : new Date(String(row.window_start));
  const elapsed = (Date.now() - windowStart.getTime()) / 1000;
  return {
    allowed: count <= limit,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsed)),
  };
}

/**
 * Deletes rows whose window ended more than `olderThanSeconds` ago. Called
 * opportunistically (a small fraction of consumes) so abandoned keys do not
 * accumulate unboundedly without a background job.
 */
export async function pruneExpiredWithExecutor(
  executor: RateLimitExecutor,
  olderThanSeconds: number,
): Promise<void> {
  await executor.query(
    `DELETE FROM "${RATE_LIMIT_TABLE}" WHERE "window_start" < now() - make_interval(secs => $1::double precision)`,
    [olderThanSeconds],
  );
}

const PRUNE_OLDER_THAN_SECONDS = 60 * 60 * 24;
const PRUNE_PROBABILITY = 0.01;

/** The limiter's single entry point: consume one unit for scope+identifier. */
export async function consumeRateLimit(
  pool: Pool,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<ConsumeResult> {
  const result = await consumeWithExecutor(
    pool,
    scope,
    identifier,
    limit,
    windowSeconds,
  );
  if (Math.random() < PRUNE_PROBABILITY) {
    // Best-effort hygiene; a failed prune must never fail the request.
    try {
      await pruneExpiredWithExecutor(pool, PRUNE_OLDER_THAN_SECONDS);
    } catch {
      // ignored
    }
  }
  return result;
}

/**
 * Rate-limit policies for the auth actions (independent per-action budgets;
 * ADR-002 §1 control 2 "independent limits"). Values are deliberately
 * stricter than legitimate interactive use but loose enough for a family
 * sharing one egress IP.
 */
export const RATE_LIMIT_POLICIES = {
  "sign-up": { ip: { limit: 10, windowSeconds: 60 * 10 }, identifier: { limit: 5, windowSeconds: 60 * 10 } },
  "sign-in": { ip: { limit: 20, windowSeconds: 60 * 10 }, identifier: { limit: 8, windowSeconds: 60 * 10 } },
  "password-reset": { ip: { limit: 6, windowSeconds: 60 * 60 }, identifier: { limit: 3, windowSeconds: 60 * 60 } },
  "verification-resend": { ip: { limit: 6, windowSeconds: 60 * 60 }, identifier: { limit: 3, windowSeconds: 60 * 60 } },
  "password-change": { ip: { limit: 10, windowSeconds: 60 * 10 }, identifier: { limit: 5, windowSeconds: 60 * 10 } },
} as const;

export type RateLimitedAction = keyof typeof RATE_LIMIT_POLICIES;
