#!/usr/bin/env node
/**
 * One-shot auth-table migration driven by better-auth's own migration
 * machinery (better-auth/db/migration -> getMigrations().runMigrations()),
 * using the exact runtime version pinned in package.json.
 *
 * Background finding (2026-11): the public @better-auth/cli package is
 * deprecated at 1.4.x and cannot drive better-auth 1.7.x, so this harness
 * invokes the package-internal runner directly. This mirrors what the
 * production migration command should do (SPEC-002 FR-41: one-shot, forward).
 *
 * Run with Node >= 22.6 (type stripping): node --experimental-strip-types
 */
import { getMigrations } from "better-auth/db/migration";
import { authOptions, DATABASE_URL } from "../src/auth.ts";

const plan = await getMigrations(authOptions, { throwOnUnsafe: false });

const summary = {
  databaseUrl: DATABASE_URL.replace(/:\/\/.*@/, "://***@"),
  tablesToCreate: plan.toBeCreated.map((t) => t.table),
  tablesToAlter: plan.toBeAdded.map((t) => t.table),
  indexesToAdd: plan.toBeAddedIndexes.map((i) => `${i.table}:${i.name}`),
  unsafeChanges: plan.unsafeChanges,
  schemaProblems: plan.schemaProblems,
};
console.log("Migration plan:");
console.log(JSON.stringify(summary, null, 2));

await plan.runMigrations();
console.log("Migrations applied successfully.");
