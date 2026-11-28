// Unit tests for the digital `database` dependency check (issue #23;
// FR-41: schema presence is readiness; sanitization rules). No real
// PostgreSQL is touched: probeDatabaseSchema runs against a fake executor
// and the registration path is exercised against the process registry.
import { describe, expect, it } from "vitest";

import {
  REQUIRED_SCHEMA_TABLES,
  databaseDependencyCheck,
  probeDatabaseSchema,
} from "../../src/server/db/database-check";
import {
  ensureDatabaseCheckRegistered,
} from "../../src/server/db/register-database-check";
import {
  getRegisteredDependencyChecks,
} from "../../src/server/readiness";

function fakeExecutor(rows: Array<Record<string, unknown>>) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    queries,
    executor: {
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return { rows };
      },
    },
  };
}

describe("database readiness check", () => {
  it("exposes the SPEC identity: name database, modes cloud+selfhost", () => {
    expect(databaseDependencyCheck.name).toBe("database");
    expect([...databaseDependencyCheck.modes].sort()).toEqual([
      "cloud",
      "selfhost",
    ]);
  });

  it("probe passes only when every required table is registered", async () => {
    const row: Record<string, unknown> = {};
    REQUIRED_SCHEMA_TABLES.forEach((table, position) => {
      row[`t${position}`] = `public.${table}`;
    });
    const { executor, queries } = fakeExecutor([row]);
    const result = await probeDatabaseSchema(executor);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.detail).toBe("database reachable; schema present");
    // Read-only: exactly one SELECT against the catalog.
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql.trim().toUpperCase().startsWith("SELECT")).toBe(
      true,
    );
    expect(queries[0]?.sql).toContain("to_regclass");
  });

  it("probe fails listing the missing tables when the schema is partial", async () => {
    const row: Record<string, unknown> = {};
    REQUIRED_SCHEMA_TABLES.forEach((table, position) => {
      row[`t${position}`] =
        table === "day_log" || table === "verification"
          ? null
          : `public.${table}`;
    });
    const result = await probeDatabaseSchema(fakeExecutor([row]).executor);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["verification", "day_log"]);
    expect(result.detail).toBe(
      "database schema incomplete: missing tables: verification, day_log",
    );
  });

  it("probe fails listing everything when the database is empty", async () => {
    const row: Record<string, unknown> = {};
    REQUIRED_SCHEMA_TABLES.forEach((_, position) => {
      row[`t${position}`] = null;
    });
    const result = await probeDatabaseSchema(fakeExecutor([row]).executor);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...REQUIRED_SCHEMA_TABLES]);
  });

  it("registration is idempotent by name+modes", () => {
    const before = getRegisteredDependencyChecks().filter(
      (check) => check.name === "database",
    ).length;
    ensureDatabaseCheckRegistered();
    ensureDatabaseCheckRegistered();
    ensureDatabaseCheckRegistered();
    const after = getRegisteredDependencyChecks().filter(
      (check) => check.name === "database",
    ).length;
    expect(after).toBe(Math.max(before, 1));
  });

  it("run() without DATABASE_URL fails sanitized with the variable name only", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const outcome = await databaseDependencyCheck.run();
      expect(outcome.ok).toBe(false);
      expect(outcome.detail).toBe("DATABASE_URL not set");
      // Sanitization contract: no connection string material.
      expect(outcome.detail).not.toMatch(/postgres|:\/\//);
    } finally {
      if (original !== undefined) {
        process.env.DATABASE_URL = original;
      }
    }
  });
});
