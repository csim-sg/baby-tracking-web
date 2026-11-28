import { defineEventHandler } from "h3";
import { auth } from "../../src/auth";

/**
 * SPIKE PROBE (retained, non-functional): attempt to mount the Better Auth
 * HTTP handler as a raw nitro (h3) server route alongside the TanStack Start
 * app. Probe endpoint would be GET /api/auth/ok -> {"ok":true} when mounted.
 *
 * VERIFIED FINDING (2026-11-28, better-auth 1.7.28 + @tanstack/react-start
 * 1.169.7 + nitro 3.0.261103-rc + vite 8.3.8): this file is NOT registered by
 * the build. Neither nitro-conventional `server/routes/**` nor
 * `src/server/routes/**` is scanned by the `tanstackStart()` + `nitro({ preset:
 * "node-server" })` wiring, and @tanstack/react-start@1.169.7 exports no
 * API-route helper (no "@tanstack/react-start/api" subpath). Both locations
 * were built and probed; /api/auth/ok returned the app 404 page.
 *
 * Consequence for ADR-002: better-auth's HTTP-layer middleware (CSRF/origin
 * validation and rate limiting) cannot be enforced through the harness's
 * programmatic auth.api surface; it requires an HTTP mount. Options: newer
 * TanStack Start API routes (>= 1.180 era), a dedicated nitro preset config
 * change, or an app-level guard. Recorded in results/FINDINGS.md (C24/C25/C26).
 */
export default defineEventHandler(async (event) => {
  const request = (event as { req?: Request }).req;
  if (!request) {
    return new Response("h3 event.req (web Request) unavailable", {
      status: 500,
    });
  }
  return auth.handler(request);
});
