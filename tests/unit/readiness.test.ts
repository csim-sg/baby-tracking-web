// Unit tests for the digital readiness state (FR-40/FR-43; ARCH-002 modes
// and readiness matrix; issue #22). computeReadiness is pure: tests inject
// dependency checks explicitly, plus one test exercising the process
// registry API.
import { describe, expect, it } from "vitest";

import {
  computeReadiness,
  getRegisteredDependencyChecks,
  registerDigitalDependencyCheck,
  type DependencyCheck,
} from "../../src/server/readiness";
import { parseRuntimeConfig } from "../../src/server/runtime-config";

const CLOUD_ENABLED_ENV = {
  DEPLOYMENT_MODE: "cloud",
  CLOUD_APP_ENABLED: "true",
  DATABASE_URL: "postgres://placeholder",
  AUTH_SECRET: "placeholder-secret",
  SMTP_HOST: "placeholder-smtp",
  SMTP_PORT: "587",
  SMTP_USER: "placeholder-smtp-user",
  SMTP_PASSWORD: "placeholder-smtp-password",
  STRIPE_SECRET_KEY: "placeholder-stripe-key",
  STRIPE_WEBHOOK_SECRET: "placeholder-webhook-secret",
  STRIPE_PRICE_ID: "placeholder-price-id",
  APP_URL: "https://toddlebook.example",
};

const SELFHOST_ENV = {
  DEPLOYMENT_MODE: "selfhost",
  DATABASE_URL: "postgres://placeholder",
  AUTH_SECRET: "placeholder-secret",
  APP_URL: "http://toddlebook.local:3000",
};

const okCheck = (
  name: DependencyCheck["name"],
  modes: DependencyCheck["modes"],
): DependencyCheck => ({
  name,
  modes,
  run: () => ({ ok: true, detail: "ready" }),
});

const failCheck = (
  name: DependencyCheck["name"],
  modes: DependencyCheck["modes"],
  detail = "connection refused",
): DependencyCheck => ({
  name,
  modes,
  run: () => ({ ok: false, detail }),
});

const throwingCheck = (
  name: DependencyCheck["name"],
  modes: DependencyCheck["modes"],
): DependencyCheck => ({
  name,
  modes,
  run: () => {
    throw new Error("boom with secrets postgres://user:pass@host");
  },
});

describe("computeReadiness — mode handling (FR-40)", () => {
  it("is not ready and names the mode for a missing DEPLOYMENT_MODE", async () => {
    const readiness = await computeReadiness(parseRuntimeConfig({}));
    expect(readiness.mode).toBeNull();
    expect(readiness.ready).toBe(false);
    expect(readiness.problems[0]?.variable).toBe("DEPLOYMENT_MODE");
    expect(readiness.checks).toEqual([]);
  });

  it("is not ready and names the mode for an unknown DEPLOYMENT_MODE", async () => {
    const readiness = await computeReadiness(
      parseRuntimeConfig({ DEPLOYMENT_MODE: "staging" }),
    );
    expect(readiness.mode).toBeNull();
    expect(readiness.ready).toBe(false);
  });
});

describe("computeReadiness — cloud launch-disabled (FR-44, matrix)", () => {
  it("is ready (config-valid) with no checks while the surface is launch-disabled", async () => {
    const readiness = await computeReadiness(
      parseRuntimeConfig({ DEPLOYMENT_MODE: "cloud" }),
    );
    expect(readiness.mode).toBe("cloud");
    expect(readiness.launchDisabled).toBe(true);
    expect(readiness.digitalEnabled).toBe(false);
    expect(readiness.configValid).toBe(true);
    expect(readiness.ready).toBe(true);
    expect(readiness.checks).toEqual([]);
  });
});

describe("computeReadiness — digital enabled, dependencies uninitialized", () => {
  it("is not ready in cloud and reports every cloud dependency uninitialized", async () => {
    const readiness = await computeReadiness(
      parseRuntimeConfig(CLOUD_ENABLED_ENV),
    );
    expect(readiness.digitalEnabled).toBe(true);
    expect(readiness.configValid).toBe(true);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.map((check) => check.name)).toEqual([
      "database",
      "auth",
      "smtp",
      "stripe",
    ]);
    expect(
      readiness.checks.every((check) => check.status === "uninitialized"),
    ).toBe(true);
  });

  it("is not ready in selfhost and reports only database and auth", async () => {
    const readiness = await computeReadiness(parseRuntimeConfig(SELFHOST_ENV));
    expect(readiness.mode).toBe("selfhost");
    expect(readiness.digitalEnabled).toBe(true);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.map((check) => check.name)).toEqual([
      "database",
      "auth",
    ]);
  });

  it("is not ready when enabled cloud configuration is invalid", async () => {
    const readiness = await computeReadiness(
      parseRuntimeConfig({
        DEPLOYMENT_MODE: "cloud",
        CLOUD_APP_ENABLED: "true",
      }),
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.configValid).toBe(false);
    expect(
      readiness.problems.some((problem) => problem.variable === "DATABASE_URL"),
    ).toBe(true);
  });
});

describe("computeReadiness — dependency checks (dependency-stop, TR-05/TR-09)", () => {
  const allOk: DependencyCheck[] = [
    okCheck("database", ["cloud", "selfhost"]),
    okCheck("auth", ["cloud", "selfhost"]),
    okCheck("smtp", ["cloud"]),
    okCheck("stripe", ["cloud"]),
  ];

  it("is ready in cloud when every dependency check passes", async () => {
    const readiness = await computeReadiness(
      parseRuntimeConfig(CLOUD_ENABLED_ENV),
      allOk,
    );
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.every((check) => check.status === "ok")).toBe(true);
  });

  it("is ready in selfhost when database and auth pass (smtp/stripe not consulted)", async () => {
    const readiness = await computeReadiness(parseRuntimeConfig(SELFHOST_ENV), [
      okCheck("database", ["cloud", "selfhost"]),
      okCheck("auth", ["cloud", "selfhost"]),
    ]);
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.map((check) => check.name)).toEqual([
      "database",
      "auth",
    ]);
  });

  it("is not ready when the database check fails, naming it", async () => {
    const readiness = await computeReadiness(
      parseRuntimeConfig(CLOUD_ENABLED_ENV),
      [
        failCheck("database", ["cloud", "selfhost"], "connection refused"),
        ...allOk.slice(1),
      ],
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.checks).toContainEqual({
      name: "database",
      status: "fail",
      detail: "connection refused",
    });
  });

  it("is not ready when a dependency check throws, without leaking the error", async () => {
    const readiness = await computeReadiness(parseRuntimeConfig(SELFHOST_ENV), [
      throwingCheck("database", ["cloud", "selfhost"]),
      okCheck("auth", ["cloud", "selfhost"]),
    ]);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks).toContainEqual({
      name: "database",
      status: "fail",
      detail: "database check threw",
    });
    expect(JSON.stringify(readiness)).not.toContain(
      "postgres://user:pass@host",
    );
  });

  it("supports async dependency checks", async () => {
    const readiness = await computeReadiness(parseRuntimeConfig(SELFHOST_ENV), [
      {
        name: "database",
        modes: ["cloud", "selfhost"],
        run: async () => ({ ok: true, detail: "ready" }),
      },
      okCheck("auth", ["cloud", "selfhost"]),
    ]);
    expect(readiness.ready).toBe(true);
  });
});

describe("dependency registry", () => {
  it("registers checks that computeReadiness picks up by default", async () => {
    expect(getRegisteredDependencyChecks()).toHaveLength(0);
    registerDigitalDependencyCheck(
      failCheck("database", ["cloud", "selfhost"], "stopped"),
    );
    expect(getRegisteredDependencyChecks()).toHaveLength(1);
    // Default path: no injected checks — the registry feeds computeReadiness.
    const readiness = await computeReadiness(parseRuntimeConfig(SELFHOST_ENV));
    expect(readiness.ready).toBe(false);
    expect(readiness.checks).toContainEqual({
      name: "database",
      status: "fail",
      detail: "stopped",
    });
    expect(readiness.checks).toContainEqual({
      name: "auth",
      status: "uninitialized",
      detail: "auth module not initialized",
    });
  });
});
