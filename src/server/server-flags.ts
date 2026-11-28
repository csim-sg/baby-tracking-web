// Public render flags for the root document (FR-03).
//
// Server-only surface: createServerFn keeps the handler (and its import of
// the runtime-config module) out of the client bundle; the client receives
// the RPC stub plus the serialized boolean result. No environment value
// crosses to the client — only the derived flag does.
//
// GTM loads on cloud `/` only. Self-host and a missing/unknown
// DEPLOYMENT_MODE load no analytics anywhere (FR-03; ARCH-002 matrix).
import { createServerFn } from "@tanstack/react-start";

import { readRuntimeConfig } from "./runtime-config";

export type PublicRenderFlags = {
  gtmEnabled: boolean;
};

export const getPublicRenderFlags = createServerFn({ method: "GET" }).handler(
  (): PublicRenderFlags => {
    const config = readRuntimeConfig();
    // FR-03: cloud `/` continues to load GTM as today (config validity of
    // the digital surface does not gate the tag); self-host and an unknown
    // or missing mode load none.
    return {
      gtmEnabled: config.mode.known && config.mode.value === "cloud",
    };
  },
);
