/**
 * Digital readiness state (FR-40, FR-43; ADR-002 §4; ARCH-002 modes and
 * readiness matrix).
 *
 * The state is computed from the runtime configuration plus the registered
 * digital dependency checks. Dependency modules (database, auth, smtp,
 * stripe) register a check when they initialize — lazily, on first digital
 * use — and never at import of the `/` render path. While a dependency is
 * not initialized or its check fails, the digital surface is not ready and
 * must fail closed.
 *
 * Pure functions; the server caches one state per process (the process
 * environment is static after boot) via `getDigitalReadiness()`.
 */

import type {
  ConfigProblem,
  DeploymentMode,
  RuntimeConfig,
} from "./runtime-config";
import { readRuntimeConfig } from "./runtime-config";

export type DependencyName = "database" | "auth" | "smtp" | "stripe";

/**
 * A lazily-initialized digital dependency's readiness check. The returned
 * detail must be sanitized: never include credentials, connection strings,
 * URLs, or free-form provider errors.
 */
export type DependencyCheck = {
  name: DependencyName;
  /** Modes in which the dependency participates. */
  modes: readonly DeploymentMode[];
  run: () =>
    Promise<{ ok: boolean; detail: string }> | { ok: boolean; detail: string };
};

export type CheckResult = {
  name: string;
  status: "ok" | "fail" | "uninitialized";
  detail: string;
};

export type DigitalReadiness = {
  mode: DeploymentMode | null;
  digitalEnabled: boolean;
  launchDisabled: boolean;
  configValid: boolean;
  /** True only when config is valid and every evaluated check passes. */
  ready: boolean;
  problems: ConfigProblem[];
  checks: CheckResult[];
};

/**
 * Registry of digital dependency checks. Digital modules register their
 * check at initialization time; until then the readiness state reports the
 * dependency as uninitialized, which fails `/readyz` and the digital
 * routes closed.
 */
const dependencyChecks: DependencyCheck[] = [];

export function registerDigitalDependencyCheck(check: DependencyCheck): void {
  dependencyChecks.push(check);
}

export function getRegisteredDependencyChecks(): readonly DependencyCheck[] {
  return dependencyChecks;
}

/**
 * Dependencies each mode's enabled digital surface depends on. A dependency
 * without a registered check is reported `uninitialized` — no dependency
 * module exists in the repository yet (schema slice #23 wires the database
 * check; auth/email follow in #24; billing in #29).
 */
const DEPENDENCY_CATALOG: Array<{
  name: DependencyName;
  modes: readonly DeploymentMode[];
}> = [
  { name: "database", modes: ["cloud", "selfhost"] },
  { name: "auth", modes: ["cloud", "selfhost"] },
  { name: "smtp", modes: ["cloud"] },
  { name: "stripe", modes: ["cloud"] },
];

export async function computeReadiness(
  config: RuntimeConfig,
  checks: readonly DependencyCheck[] = getRegisteredDependencyChecks(),
): Promise<DigitalReadiness> {
  const problems: ConfigProblem[] = [...config.problems];

  if (!config.mode.known) {
    // Digital-disabled (FR-40): nothing further to evaluate.
    return {
      mode: null,
      digitalEnabled: false,
      launchDisabled: false,
      configValid: false,
      ready: false,
      problems,
      checks: [],
    };
  }

  const mode = config.mode.value;

  if (!config.digitalEnabled) {
    // Cloud launch-disabled (FR-44): a config-valid, intentional 404 state.
    // The matrix reports /readyz 200 here — there is no digital surface to
    // make ready. (/healthz is always 200; deployment health checks must use
    // /healthz and never restart-loop on digital configuration.)
    return {
      mode,
      digitalEnabled: false,
      launchDisabled: true,
      configValid: config.configValid,
      ready: config.configValid,
      problems,
      checks: [],
    };
  }

  // Digital surface enabled: evaluate the mode's dependency catalog.
  const results: CheckResult[] = [];
  for (const entry of DEPENDENCY_CATALOG) {
    if (!entry.modes.includes(mode)) {
      continue;
    }
    const registered = checks.find(
      (check) =>
        check.name === entry.name &&
        entry.modes.every((m) => check.modes.includes(m)),
    );
    if (!registered) {
      results.push({
        name: entry.name,
        status: "uninitialized",
        detail: `${entry.name} module not initialized`,
      });
      continue;
    }
    try {
      const outcome = await registered.run();
      results.push({
        name: entry.name,
        status: outcome.ok ? "ok" : "fail",
        detail: outcome.detail,
      });
    } catch {
      results.push({
        name: entry.name,
        status: "fail",
        detail: `${entry.name} check threw`,
      });
    }
  }

  const ready =
    config.configValid && results.every((result) => result.status === "ok");
  return {
    mode,
    digitalEnabled: true,
    launchDisabled: false,
    configValid: config.configValid,
    ready,
    problems,
    checks: results,
  };
}

let cachedReadiness: Promise<DigitalReadiness> | null = null;

/**
 * Process-wide readiness state, computed once from the live environment.
 * Server-side only.
 */
export function getDigitalReadiness(): Promise<DigitalReadiness> {
  cachedReadiness ??= computeReadiness(readRuntimeConfig());
  return cachedReadiness;
}
