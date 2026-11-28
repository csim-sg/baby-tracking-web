#!/usr/bin/env node
/**
 * One-shot migration command — `npm run migrate` (SPEC-002 FR-41/TR-09;
 * ADR-002 §6; issue #23).
 *
 * Fixed order, fail-fast, forward-only:
 *   1. Auth-owned tables (`user`, `session`, `account`, `verification`) via
 *      Better Auth 1.7.28's own package-internal migration runner
 *      (`better-auth/db/migration` → `getMigrations(...)` → `runMigrations()`).
 *      The public @better-auth/cli is deprecated at 1.4.x and cannot drive
 *      1.7.x (issue #18 finding). The runner is idempotent by construction:
 *      it re-introspects the catalog each run and emits only the missing
 *      DDL; it executes statement-per-statement (no enclosing transaction)
 *      and keeps no migration-state table. Recorded per FR-41 in
 *      src/server/db/README.md.
 *   2. Application tables via the committed SQL migrations in
 *      src/server/db/migrations/, applied in filename order, each file in
 *      ONE explicit transaction (atomic; a failure rolls back that file and
 *      exits non-zero). Files are idempotent (IF NOT EXISTS / guarded
 *      constraints), so a re-run is a safe no-op and no migration-state
 *      table exists.
 *
 * The application NEVER calls this: migrations run as a separate one-shot
 * step before a new version is exposed. Never run it from the app process.
 *
 * Env: DATABASE_URL (required). APP_URL (optional; auth runner baseURL).
 * Exit codes: 0 success (including idempotent re-run), 1 any failure.
 */
import { getMigrations } from "better-auth/db/migration";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { authMigrationOptions } from "../src/server/db/auth-migration-config.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(scriptDir, "..", "src", "server", "db", "migrations");

function fail(message) {
  console.error(`migrate: FAILED: ${message}`);
  process.exit(1);
}

/** Masks credentials; connection URLs are never echoed whole. */
function sanitizeUrl(url) {
  return url.replace(/\/\/[^@/]*@/, "//***@");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl.trim() === "") {
  fail("DATABASE_URL is not set; refusing to migrate");
}
console.log(`migrate: target ${sanitizeUrl(databaseUrl)}`);

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
});

try {
  // --- Phase 1: auth-owned tables (library runner) ---
  const plan = await getMigrations(authMigrationOptions(pool), {
    throwOnUnsafe: false,
  });
  console.log(
    "migrate: auth runner plan: " +
      JSON.stringify({
        tablesToCreate: plan.toBeCreated.map((t) => t.table),
        tablesToAlter: plan.toBeAdded.map((t) => t.table),
        indexesToAdd: plan.toBeAddedIndexes.map(
          (i) => `${i.table}:${i.name}`,
        ),
        unsafeChanges: plan.unsafeChanges,
      }),
  );
  await plan.runMigrations();
  console.log(
    "migrate: auth runner applied (idempotent catalog diff; statement-per-statement; no state table)",
  );

  // --- Phase 2: application tables (committed SQL, ordered, transactional) ---
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    fail(`no application migration files found in ${migrationsDir}`);
  }

  const client = await pool.connect();
  try {
    const before = await client.query(
      "SELECT to_regclass($1)::text AS present",
      ["public.child_profile"],
    );
    console.log(
      `migrate: application schema present before run: ${
        before.rows[0]?.present ? "yes" : "no"
      } (idempotent re-run expected when yes)`,
    );

    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`migrate: applied ${file} (one transaction, idempotent)`);
      } catch (error) {
        await client.query("ROLLBACK");
        fail(`application migration ${file} failed; rolled back: ${error.message}`);
      }
    }
  } finally {
    client.release();
  }

  console.log(
    `migrate: OK — ${files.length} application migration file(s) verified applied; forward-only; re-run is a no-op`,
  );
} catch (error) {
  fail(`migration failed: ${error.message}`);
} finally {
  await pool.end().catch(() => {});
}
