// Public render flags for the root document (FR-03; issue #24 carry-forward
// #2: the flag must become ROUTE-AWARE once /app and the auth pages render
// HTML in cloud).
//
// Server-only surface: createServerFn keeps the handler (and its import of
// the runtime-config module) out of the client bundle; the client receives
// the RPC stub plus the serialized boolean result. No environment value
// crosses to the client — only the derived flag does.
//
// GTM loads on cloud `/` ONLY. Auth pages, /app, API paths and any other
// path never load it, in either mode; self-host and a missing/unknown
// DEPLOYMENT_MODE load no analytics anywhere (FR-03; FR-38; ARCH-002
// analytics boundary). The caller passes the document's pathname — the
// route-aware decision is computed from the route, not from client state.
import { createServerFn } from "@tanstack/react-start";

import { readRuntimeConfig } from "./runtime-config";

export type PublicRenderFlags = {
  gtmEnabled: boolean;
};

/** Paths that must NEVER carry analytics, whatever the mode (FR-03/FR-38). */
function isDigitalPath(pathname: string): boolean {
  return (
    pathname.startsWith("/app") ||
    pathname.startsWith("/api") ||
    pathname === "/sign-in" ||
    pathname === "/sign-up" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email" ||
    pathname.startsWith("/sign-in/") ||
    pathname.startsWith("/sign-up/") ||
    pathname.startsWith("/forgot-password/") ||
    pathname.startsWith("/reset-password/") ||
    pathname.startsWith("/verify-email/")
  );
}

export const getPublicRenderFlags = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { pathname?: string })
  .handler(({ data }): PublicRenderFlags => {
    const config = readRuntimeConfig();
    const pathname = ((data as { pathname?: string } | undefined)?.pathname ?? "/").split("?")[0];
    // FR-03: cloud `/` continues to load GTM as today (config validity of
    // the digital surface does not gate the tag); everything else — cloud
    // or not — loads none.
    const gtmEnabled =
      config.mode.known &&
      config.mode.value === "cloud" &&
      pathname === "/" &&
      !isDigitalPath(pathname);
    return { gtmEnabled };
  });
