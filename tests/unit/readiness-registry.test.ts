// Review loop 1 (PR #45 finding 2): the digital dependency registry must be
// process-wide across every bundled copy of src/server/readiness.ts. Nitro
// can emit a shared server module into more than one server graph (main
// bundle and SSR bundle), so module-scope state cannot be relied on — a
// check registered through one copy must be visible through every copy.
// The registry is therefore anchored on a stable globalThis key. This test
// recreates the duplication cheaply without a build: vi.resetModules() plus
// two dynamic imports produce two separate module instances of the same
// source, and registration through the first must be observed through the
// second — including via computeReadiness's default registry path.
import { describe, expect, it, vi } from "vitest";

import { parseRuntimeConfig } from "../../src/server/runtime-config";

const READINESS_MODULE = "../../src/server/readiness";

describe("dependency registry sharing across module instances", () => {
  it("two dynamic imports after vi.resetModules() create separate module instances that share one registry", async () => {
    vi.resetModules();
    const first = await import(READINESS_MODULE);
    vi.resetModules();
    const second = await import(READINESS_MODULE);

    // Separate module instances (fresh module-scope state), as the bundled
    // server graphs produce:
    expect(first).not.toBe(second);

    const initialCount = second.getRegisteredDependencyChecks().length;

    // Register through the first instance…
    first.registerDigitalDependencyCheck({
      name: "auth",
      modes: ["cloud", "selfhost"],
      run: () => ({ ok: true, detail: "ready" }),
    });

    // …and observe through the second: the same registry array, one new
    // registration visible.
    expect(second.getRegisteredDependencyChecks()).toBe(
      first.getRegisteredDependencyChecks(),
    );
    expect(second.getRegisteredDependencyChecks()).toHaveLength(
      initialCount + 1,
    );
    expect(second.getRegisteredDependencyChecks().at(-1)?.name).toBe("auth");

    // The default computeReadiness path (registry injection) in the second
    // instance sees the registration made through the first — the failure
    // mode the /readyz handler must never hit:
    const readiness = await second.computeReadiness(
      parseRuntimeConfig({
        DEPLOYMENT_MODE: "selfhost",
        DATABASE_URL: "postgres://placeholder",
        AUTH_SECRET: "placeholder-secret",
        APP_URL: "http://toddlebook.local:3000",
      }),
    );
    expect(readiness.checks).toContainEqual({
      name: "auth",
      status: "ok",
      detail: "ready",
    });
  });
});
