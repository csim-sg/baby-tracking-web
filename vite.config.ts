import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Explicit nitro route handlers (T1 finding F4: this TanStack Start version
// has no API-route mount and nitro does not scan server/routes/**).
//
// - /healthz, /readyz: root-level liveness and readiness (FR-43) — never
//   /api/healthz or /api/readyz.
// - Digital surface gate (issue #24): /app (+ subtree) and the auth pages are
//   real SSR routes rendered by the framework renderer (`/**`). Their
//   fail-closed contract is carried by `digital-gate-middleware.ts`,
//   registered as a nitro MIDDLEWARE handler (`middleware: true`, route
//   "/**") so it runs BEFORE the renderer: not ready → 503 naming the
//   failure; `CLOUD_APP_ENABLED=false` → 404; ready but unknown digital
//   subpath → 404; ready `/app` without a session → 302 to /sign-in with a
//   local return path; ready exact pages → fall through to the renderer.
//   Nitro's built-in renderer streams only the SSR response BODY (every
//   document leaves it as 200 text/html), so non-200 digital statuses MUST
//   be produced before the renderer — the middleware (and the nitro
//   handlers below, which #22/#23 proved) are where statuses survive.
//   Proven per-status by scripts/smoke/runtime-modes.mjs on this exact
//   build. Server functions invoked by the rendered pages gate themselves
//   (src/server/auth/guard.ts) — a direct RPC call cannot bypass the gate.
// - /api/auth/** stays fail-closed because no real endpoint exists on this
//   stack (F4: auth runs through server functions, not an HTTP mount), and
//   /api/stripe/webhook stays gated until billing (#29).
const serverHandlers = [
  {
    route: "/**",
    middleware: true,
    handler: "./src/server/handlers/digital-gate-middleware.ts",
  },
  { route: "/healthz", handler: "./src/server/handlers/healthz.ts" },
  { route: "/readyz", handler: "./src/server/handlers/readyz.ts" },
  {
    route: "/api/auth/**",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
  {
    route: "/api/stripe/webhook",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
];

// TR-14 security headers for the digital documents the renderer serves (the
// renderer does not forward SSR-set headers, so static route rules carry
// them). `/` and free paths are unaffected.
const digitalSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};
const digitalSecurityRouteRules = Object.fromEntries(
  ["/app", "/app/**", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify-email"].map(
    (route) => [route, { headers: digitalSecurityHeaders }],
  ),
);

export default defineConfig({
  plugins: [
    tanstackStart(),
    nitro({
      preset: "node-server",
      handlers: serverHandlers,
      routeRules: digitalSecurityRouteRules,
      // The repo-root index.html (a SPEC-001 artifact) makes nitro default to
      // its generic renderer template, which streams only the SSR response
      // BODY — every document and server-function response would leave the
      // server as 200 text/html with the status and headers (Set-Cookie,
      // x-tss-*) discarded. Disabling the template renderer selects nitro's
      // `ssr-renderer` (the services.ssr build this TanStack Start plugin
      // produces), which returns the SSR response VERBATIM — real 302/404/
      // 503 statuses, security headers, and client-usable RPC responses.
      renderer: false,
    }),
    viteReact(),
    tailwindcss(),
  ],
});
