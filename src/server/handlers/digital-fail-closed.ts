// Fail-closed handler for the digital surface entries that remain gated at
// the HTTP layer: /api/auth/* (no real endpoint exists on this stack — T1 F4
// proved the library router cannot be mounted; auth runs through server
// functions) and POST /api/stripe/webhook (billing is #29). Serves the
// 503/404 gate response for every method so no gated path can fall through
// to the SSR catch-all (which would return the `/` document, GTM included,
// with a 200).
//
// The /app and auth-page entries were replaced in issue #24 by real TanStack
// Start routes with an equivalent fail-closed guard inside their route/
// server-function boundary (src/server/auth/guard.ts + the $.tsx splat
// routes); parity of responses is proven by scripts/smoke/runtime-modes.mjs.
import { defineEventHandler, setResponseStatus } from "nitro/h3";

// Side-effect imports: register the `database` (#23), `auth` and `smtp`
// (#24) checks at server start so the fail-closed gate's readiness
// evaluation includes live dependency state (registration is idempotent by
// name+modes on the process-wide registry).
import "../db/register-database-check";
import "../auth/register-checks";

import { digitalGateResponse, type DigitalSurface } from "../digital-gate";

function surfaceForPath(pathname: string): DigitalSurface {
  if (pathname === "/api/stripe/webhook") {
    return "webhook";
  }
  return "auth";
}

export default defineEventHandler(async (event) => {
  const { status, body } = await digitalGateResponse(
    surfaceForPath(event.url.pathname),
  );
  setResponseStatus(event, status);
  return body;
});
