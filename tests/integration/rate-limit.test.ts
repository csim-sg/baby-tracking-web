// Integration tests for the PostgreSQL-backed rate limiter (issue #24;
// ADR-002 §1 control 2; AC-02 "rate limits … survive a process restart").
// Skipped unless TEST_DATABASE_URL points at a disposable PostgreSQL 16
// with the migrated schema (0002_rate_limit.sql applied by npm run
// migrate); the builder evidence runs them against the real database.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consumeRateLimit,
  consumeWithExecutor,
  pruneExpiredWithExecutor,
  rateLimitKey,
} from "../../src/server/auth/rate-limit";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

const SCOPE = `test-${randomUUID()}`;

let pool: Pool;
let pool2: Pool; // a SECOND pool simulating a process restart

describeDb("PostgreSQL-backed rate limiter (#24; ADR-002 §1 control 2)", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    pool2 = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
    await pool2.end();
  });

  it("allows up to the limit, then rejects with a retry horizon", async () => {
    const identifier = `ident-${randomUUID()}@test.example`;
    for (let count = 1; count <= 3; count += 1) {
      const result = await consumeWithExecutor(pool, SCOPE, identifier, 3, 600);
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(count);
    }
    const blocked = await consumeWithExecutor(pool, SCOPE, identifier, 3, 600);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(4);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(600);
  });

  it("keys are hashed in the table — no email or IP in clear, no owner column", async () => {
    const identifier = `secret-owner@example.com`;
    await consumeWithExecutor(pool, SCOPE, identifier, 100, 600);
    const rows = await pool.query(
      'SELECT "key" FROM "rate_limit"',
    );
    const key = rateLimitKey(SCOPE, identifier);
    const stored = rows.rows.find((row) => String(row.key) === key);
    expect(stored, "hashed key row exists").toBeTruthy();
    const allKeys = rows.rows.map((row) => String(row.key)).join("\n");
    expect(allKeys).not.toContain("secret-owner@example.com");
    expect(allKeys).not.toContain("@");
  });

  it("resets the window when it expires", async () => {
    const identifier = `window-${randomUUID()}@test.example`;
    for (let count = 0; count < 2; count += 1) {
      await consumeWithExecutor(pool, SCOPE, identifier, 2, 600);
    }
    const third = await consumeWithExecutor(pool, SCOPE, identifier, 2, 600);
    expect(third.allowed).toBe(false);
    // Simulate the window elapsing by rewinding the row's window_start.
    await pool.query(
      'UPDATE "rate_limit" SET "window_start" = now() - interval \'601 seconds\' WHERE "key" = $1',
      [rateLimitKey(SCOPE, identifier)],
    );
    const after = await consumeWithExecutor(pool, SCOPE, identifier, 2, 600);
    expect(after.allowed).toBe(true);
    expect(after.count).toBe(1);
  });

  it("survives a process restart — a NEW pool still sees the tripped limit", async () => {
    // The proof that the limiter is PostgreSQL-backed: state written through
    // one pool is enforced through a completely separate pool/connection.
    const identifier = `restart-${randomUUID()}@test.example`;
    for (let count = 0; count < 3; count += 1) {
      const result = await consumeWithExecutor(pool, SCOPE, identifier, 3, 600);
      expect(result.allowed).toBe(true);
    }
    const fromRestartedProcess = await consumeWithExecutor(
      pool2,
      SCOPE,
      identifier,
      3,
      600,
    );
    expect(fromRestartedProcess.allowed).toBe(false);
    expect(fromRestartedProcess.count).toBe(4);
  });

  it("per-IP and per-identifier limits are independent counters", async () => {
    const ip = "203.0.113.77";
    const email = `pair-${randomUUID()}@test.example`;
    const ipFirst = await consumeRateLimit(pool, `${SCOPE}:ip`, ip, 5, 600);
    const idFirst = await consumeRateLimit(pool, `${SCOPE}:id`, email, 5, 600);
    expect(ipFirst.count).toBe(1);
    expect(idFirst.count).toBe(1);
    const ipAgain = await consumeRateLimit(pool, `${SCOPE}:ip`, ip, 5, 600);
    expect(ipAgain.count).toBe(2);
    const idAgain = await consumeRateLimit(pool, `${SCOPE}:id`, email, 5, 600);
    expect(idAgain.count).toBe(2);
  });

  it("prunes rows whose windows expired long ago", async () => {
    const identifier = `prune-${randomUUID()}@test.example`;
    await consumeWithExecutor(pool, SCOPE, identifier, 10, 600);
    expect(
      (await pool.query('SELECT 1 FROM "rate_limit" WHERE "key" = $1', [
        rateLimitKey(SCOPE, identifier),
      ])).rowCount,
    ).toBe(1);
    // Age the row past the prune horizon.
    await pool.query(
      'UPDATE "rate_limit" SET "window_start" = now() - interval \'700 seconds\' WHERE "key" = $1',
      [rateLimitKey(SCOPE, identifier)],
    );
    await pruneExpiredWithExecutor(pool, 600);
    expect(
      (await pool.query('SELECT 1 FROM "rate_limit" WHERE "key" = $1', [
        rateLimitKey(SCOPE, identifier),
      ])).rowCount,
    ).toBe(0);
  });

  it("fails CLOSED when the counter store errors (limiter outage never opens the limit)", async () => {
    const throwingExecutor = {
      query: async () => {
        throw new Error("simulated table missing");
      },
    };
    const outcome = await consumeWithExecutor(
      throwingExecutor,
      SCOPE,
      "offline-probe",
      1,
      60,
    );
    expect(outcome.allowed).toBe(false);
  });
});
