// Readiness endpoint (FR-43): 200 only when configuration is valid and the
// digital dependencies are reachable; otherwise 503 with a structured reason
// naming the missing/invalid variable or failed dependency. Values of
// configuration variables are never included.
//
// The side-effect imports register the `database` (#23), `auth` and `smtp`
// (#24) dependency checks when this module loads at SERVER START (not on
// first request), so a cold-start /readyz answers truthfully (FR-43; #22
// carry-forward #4). Registration is idempotent by name+modes on the
// process-wide registry. `stripe` stays unregistered until #29, so a
// launch-enabled cloud keeps reporting 503 naming `stripe: uninitialized`
// after this issue — do not claim cloud readiness 200.
import { defineEventHandler, setResponseStatus } from "nitro/h3";

import "../db/register-database-check";
import "../auth/register-checks";
import { getDigitalReadiness } from "../readiness";

export default defineEventHandler(async (event) => {
  const readiness = await getDigitalReadiness();
  setResponseStatus(event, readiness.ready ? 200 : 503);
  return {
    status: readiness.ready ? "ok" : "unavailable",
    mode: readiness.mode,
    digitalEnabled: readiness.digitalEnabled,
    launchDisabled: readiness.launchDisabled,
    problems: readiness.problems,
    checks: readiness.checks,
  };
});
