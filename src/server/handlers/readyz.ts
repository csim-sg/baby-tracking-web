// Readiness endpoint (FR-43): 200 only when configuration is valid and the
// digital dependencies are reachable; otherwise 503 with a structured reason
// naming the missing/invalid variable or failed dependency. Values of
// configuration variables are never included.
import { defineEventHandler, setResponseStatus } from "h3";

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
