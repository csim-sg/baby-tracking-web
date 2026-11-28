/**
 * Server-start registration of the digital `auth` (both modes) and `smtp`
 * (cloud) dependency checks (issue #24; #22 carry-forward #3/#4; FR-40/
 * FR-43). Import this module for its side effect from the server handler
 * graph (readyz + digital-fail-closed) so a cold-start /readyz answers
 * truthfully. Registration is idempotent by name+modes on the process-wide
 * `globalThis.__toddlebook_digital_dependency_checks__` registry.
 *
 * Matrix consequences (tech-lead acceptance interpretation, #24):
 * - self-host, valid config, migrated+reachable database → `database` ok +
 *   `auth` ok → /readyz 200;
 * - cloud launch-enabled, all vars set → `database`/`auth`/`smtp` evaluated
 *   while `stripe` stays `uninitialized` (registered by #29) → /readyz STILL
 *   503 naming stripe — cloud readiness 200 must never be claimed here;
 * - cloud launch-disabled → no checks evaluated (unchanged #22 behavior).
 *
 * The `auth` check is instance initialization + a bounded, READ-ONLY catalog
 * probe of the four library-owned tables. The `smtp` check is config-derived
 * ONLY (carry-forward #4): no network probe, so provider latency can never
 * turn readiness into a global 503; SMTP delivery is proven by the E2E test.
 */

import type { DependencyCheck } from "../readiness";
import { getRegisteredDependencyChecks, registerDigitalDependencyCheck } from "../readiness";
import { getDatabasePool } from "../db/pool";
import { getAuthInstance } from "./instance";
import { smtpSettingsFromEnv } from "./mailer";

const AUTH_TABLES = ["user", "session", "account", "verification"] as const;

async function runAuthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    // Construction resolves options; `$context` initializes the adapters
    // without opening database connections (lazy pool — see ./pool.ts).
    await getAuthInstance().$context;
  } catch {
    return { ok: false, detail: "auth instance failed to initialize" };
  }
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === "") {
    return { ok: false, detail: "DATABASE_URL not set" };
  }
  let client;
  try {
    client = await getDatabasePool().connect();
  } catch {
    return { ok: false, detail: "auth tables probe failed: connection" };
  }
  try {
    const columns = AUTH_TABLES.map(
      (_, position) => `to_regclass($${position + 1}) AS t${position}`,
    ).join(", ");
    const result = await client.query(
      `SELECT ${columns}`,
      AUTH_TABLES.map((table) => `public."${table}"`),
    );
    const row = result.rows[0] ?? {};
    const missing = AUTH_TABLES.filter(
      (_, position) =>
        row[`t${position}`] === null || row[`t${position}`] === undefined,
    );
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `auth tables missing: ${missing.join(", ")}`,
      };
    }
    return { ok: true, detail: "auth instance initialized; tables present" };
  } catch {
    return { ok: false, detail: "auth tables probe failed" };
  } finally {
    client.release();
  }
}

async function runSmtpCheck(): Promise<{ ok: boolean; detail: string }> {
  // Config-derived only (carry-forward #4): settings presence, never a
  // network probe. Values are never included in the detail (FR-40).
  const settings = smtpSettingsFromEnv();
  if (!settings) {
    return { ok: false, detail: "SMTP settings missing or invalid" };
  }
  return { ok: true, detail: "SMTP settings present" };
}

export const authDependencyCheck: DependencyCheck = {
  name: "auth",
  modes: ["cloud", "selfhost"],
  run: runAuthCheck,
};

export const smtpDependencyCheck: DependencyCheck = {
  name: "smtp",
  modes: ["cloud"],
  run: runSmtpCheck,
};

/** True when a check with the same name and the same mode set is present. */
function hasEquivalentCheck(check: DependencyCheck): boolean {
  const expected = [...check.modes].sort().join("|");
  return getRegisteredDependencyChecks().some((existing) => {
    if (existing.name !== check.name) {
      return false;
    }
    return [...existing.modes].sort().join("|") === expected;
  });
}

/**
 * Registers both checks unless equivalents are present. Exported for tests;
 * the module import below performs the same calls at server start.
 */
export function ensureAuthChecksRegistered(): void {
  if (!hasEquivalentCheck(authDependencyCheck)) {
    registerDigitalDependencyCheck(authDependencyCheck);
  }
  if (!hasEquivalentCheck(smtpDependencyCheck)) {
    registerDigitalDependencyCheck(smtpDependencyCheck);
  }
}

ensureAuthChecksRegistered();
