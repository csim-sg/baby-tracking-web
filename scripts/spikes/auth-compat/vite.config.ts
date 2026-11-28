import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

// Mirrors the root application build (TanStack Start + nitro node-server preset
// + React plugin) with the exact resolved root versions pinned in package.json.
export default defineConfig({
  plugins: [tanstackStart(), nitro({ preset: "node-server" }), viteReact()],
});
