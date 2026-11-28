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
// - Digital surface gate: /app (+ subtree), the auth pages, /api/auth/* and
//   /api/stripe/webhook fail closed (503) or return the launch-disabled 404
//   (FR-40/FR-44) instead of falling through to the SSR catch-all.
const serverHandlers = [
  { route: "/healthz", handler: "./src/server/handlers/healthz.ts" },
  { route: "/readyz", handler: "./src/server/handlers/readyz.ts" },
  { route: "/app", handler: "./src/server/handlers/digital-fail-closed.ts" },
  { route: "/app/**", handler: "./src/server/handlers/digital-fail-closed.ts" },
  {
    route: "/sign-in",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
  {
    route: "/sign-up",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
  {
    route: "/forgot-password",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
  {
    route: "/reset-password",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
  {
    route: "/verify-email",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
  {
    route: "/api/auth/**",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
  {
    route: "/api/stripe/webhook",
    handler: "./src/server/handlers/digital-fail-closed.ts",
  },
];

export default defineConfig({
  plugins: [
    tanstackStart(),
    nitro({ preset: "node-server", handlers: serverHandlers }),
    viteReact(),
    tailwindcss(),
  ],
});
