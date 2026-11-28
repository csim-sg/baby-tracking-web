// Minimal Vitest runner for the unit suite (issue #22 scope: config and
// readiness tests; full suite/CI consolidation belongs to #35). Node
// environment only — no DOM plugins are loaded for tests.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
