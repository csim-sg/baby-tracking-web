/**
 * Server-start registration of the digital `database` dependency check
 * (issue #23; #22 carry-forward #4: register at server start, not on first
 * digital request — FR-43 requires a cold-start /readyz to answer
 * truthfully, so the check must exist before the first request arrives).
 *
 * Import this module for its side effect from the server handler graph
 * (readyz and digital-fail-closed). Registration is idempotent by
 * name+modes, so the two handler entry points — potentially separate
 * bundled copies of shared server modules — can both import it safely; the
 * registry itself is process-wide on
 * `globalThis.__toddlebook_digital_dependency_checks__`.
 */

import {
  getRegisteredDependencyChecks,
  registerDigitalDependencyCheck,
} from "../readiness";
import { databaseDependencyCheck } from "./database-check";

/** True when a check with the same name and the same mode set is present. */
function hasEquivalentCheck(): boolean {
  const expected = [...databaseDependencyCheck.modes].sort().join("|");
  return getRegisteredDependencyChecks().some((existing) => {
    if (existing.name !== databaseDependencyCheck.name) {
      return false;
    }
    return [...existing.modes].sort().join("|") === expected;
  });
}

/**
 * Registers the database check unless an equivalent one is already present.
 * Exported for tests; the module import below performs the same call at
 * server start.
 */
export function ensureDatabaseCheckRegistered(): void {
  if (!hasEquivalentCheck()) {
    registerDigitalDependencyCheck(databaseDependencyCheck);
  }
}

ensureDatabaseCheckRegistered();
