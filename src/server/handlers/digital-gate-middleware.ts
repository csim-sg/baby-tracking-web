// Digital-surface gate middleware (issue #24; FR-40/FR-43/FR-44; TR-09;
// #24 carry-forward #1: "replace an entry only together with an equivalent
// fail-closed guard").
//
// The #22 nitro entries for /app and the auth pages were replaced by real
// SSR routes rendered by the framework renderer. This handler is registered
// as a nitro MIDDLEWARE (`middleware: true`, route "/**" — vite.config.ts)
// so it runs before the renderer and carries the fail-closed contract with
// REAL statuses (the renderer streams only the SSR response body — every
// document leaves it as 200 text/html — so statuses must be produced here,
// the same reason /readyz is a nitro handler):
//
// - digital path while the surface is not ready → 503 JSON naming the
//   failure (the #22 gate body);
// - digital path with `CLOUD_APP_ENABLED=false` → 404 JSON (intentional
//   launch state);
// - ready but unknown subpath under a digital prefix (e.g. /app/xyz) → 404
//   JSON — never the SSR catch-all 200 HTML;
// - ready `/app` or `/app/settings` without a session → 302 to /sign-in
//   with a LOCAL return path (FR-08; the route's beforeLoad re-checks);
// - ready `/app` with an unverified cloud email → 302 to the
//   verification-pending state (FR-06; re-checked in the route);
// - ready exact digital pages → return `undefined` so the request falls
//   through to the renderer (h3's `isUnhandledResponse` contract).
//
// Non-digital paths (including `/` and the server-function RPC namespace)
// return `undefined` immediately and never compute readiness (FR-02: the
// free product never touches digital modules). Server functions invoked by
// the rendered pages gate themselves (src/server/auth/guard.ts) — a direct
// RPC call cannot bypass this gate.
import { defineEventHandler } from "nitro/h3";

// Side-effect imports: register the `database` (#23), `auth` and `smtp`
// (#24) checks at server start so the gate's readiness evaluation includes
// live dependency state (idempotent by name+modes on the process-wide
// registry; registered by every server-start handler graph).
import "../db/register-database-check";
import "../auth/register-checks";

import { getAuthInstance } from "../auth/instance";
import { emailVerificationRequired } from "../auth/mailer";
import { gateResponseFor, type DigitalSurface } from "../digital-gate";
import { getDigitalReadiness } from "../readiness";

/** The exact digital document paths this slice serves (SPEC route table). */
const DIGITAL_EXACT_PATHS = new Set([
  "/app",
  "/app/settings",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

/** Unknown subpaths under these prefixes stay inside the digital gate. */
const DIGITAL_PREFIXES = [
  "/app/",
  "/sign-in/",
  "/sign-up/",
  "/forgot-password/",
  "/reset-password/",
  "/verify-email/",
];

function isDigitalPath(pathname: string): boolean {
  return (
    DIGITAL_EXACT_PATHS.has(pathname) ||
    DIGITAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function surfaceForPath(pathname: string): DigitalSurface {
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    return "app";
  }
  return "auth";
}

const GATE_JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store" },
  });
}

export default defineEventHandler(async (event) => {
  const pathname = event.url.pathname;
  if (!isDigitalPath(pathname)) {
    // Fall through: free surfaces and non-document requests are untouched.
    return undefined;
  }

  const readiness = await getDigitalReadiness();
  if (!readiness.ready || readiness.launchDisabled) {
    // Fail-closed: the exact #22 gate responses, verbatim.
    const { status, body } = gateResponseFor(surfaceForPath(pathname), readiness);
    return new Response(JSON.stringify(body), {
      status,
      headers: GATE_JSON_HEADERS,
    });
  }

  // Ready: unknown subpaths never reach the renderer's catch-all.
  if (!DIGITAL_EXACT_PATHS.has(pathname)) {
    return new Response(JSON.stringify({ error: "not_found", detail: "Page not found" }), {
      status: 404,
      headers: GATE_JSON_HEADERS,
    });
  }

  // Session boundary for the app surface (real 302s; the route's beforeLoad
  // re-checks for defense in depth and client-side navigations).
  if (pathname === "/app" || pathname === "/app/settings") {
    try {
      const session = await getAuthInstance().api.getSession({
        headers: event.req.headers,
      });
      if (!session?.user) {
        return redirect(`/sign-in?return=${encodeURIComponent(pathname)}`);
      }
      if (emailVerificationRequired() && !session.user.emailVerified) {
        return redirect(
          `/verify-email?status=pending&email=${encodeURIComponent(session.user.email)}`,
        );
      }
    } catch {
      // Session resolution failed: fail closed to the sign-in redirect.
      return redirect(`/sign-in?return=${encodeURIComponent(pathname)}`);
    }
  }

  // Ready exact page: fall through to the renderer.
  return undefined;
});
