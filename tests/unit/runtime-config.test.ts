// Unit tests for runtime-mode configuration parsing (FR-40; issue #22).
// parseRuntimeConfig is pure: every scenario passes an explicit env record,
// never process.env.
import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "../../src/server/runtime-config";

const CLOUD_ENABLED_VARS = {
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

describe("parseRuntimeConfig — mode parsing (FR-40)", () => {
  it("treats a missing DEPLOYMENT_MODE as digital-disabled", () => {
    const config = parseRuntimeConfig({});
    expect(config.mode).toEqual({ known: false, value: null });
    expect(config.configValid).toBe(false);
    expect(config.digitalEnabled).toBe(false);
    expect(config.launchDisabled).toBe(false);
    expect(config.problems).toHaveLength(1);
    expect(config.problems[0]?.variable).toBe("DEPLOYMENT_MODE");
    expect(config.problems[0]?.detail).toMatch(/not set/);
  });

  it("treats an unknown DEPLOYMENT_MODE as digital-disabled and names it", () => {
    const config = parseRuntimeConfig({ DEPLOYMENT_MODE: "hybrid" });
    expect(config.mode).toEqual({ known: false, value: "hybrid" });
    expect(config.digitalEnabled).toBe(false);
    expect(config.problems[0]?.variable).toBe("DEPLOYMENT_MODE");
    expect(config.problems[0]?.detail).toMatch(/must be "cloud" or "selfhost"/);
  });

  it("trims and lowercases the mode value", () => {
    expect(parseRuntimeConfig({ DEPLOYMENT_MODE: "  CLOUD " }).mode).toEqual({
      known: true,
      value: "cloud",
    });
    expect(parseRuntimeConfig({ DEPLOYMENT_MODE: "SelfHost" }).mode).toEqual({
      known: true,
      value: "selfhost",
    });
  });
});

describe("parseRuntimeConfig — cloud (FR-40/FR-44)", () => {
  it("defaults CLOUD_APP_ENABLED to false (launch-disabled, config-valid)", () => {
    const config = parseRuntimeConfig({ DEPLOYMENT_MODE: "cloud" });
    expect(config.mode).toEqual({ known: true, value: "cloud" });
    expect(config.configValid).toBe(true);
    expect(config.digitalEnabled).toBe(false);
    expect(config.launchDisabled).toBe(true);
    expect(config.problems).toEqual([]);
  });

  it("parses an explicit CLOUD_APP_ENABLED=false as launch-disabled", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "false",
    });
    expect(config.launchDisabled).toBe(true);
    expect(config.configValid).toBe(true);
  });

  it("accepts case variants of the launch flag", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "True",
    });
    expect(config.digitalEnabled).toBe(true);
    expect(config.launchDisabled).toBe(false);
  });

  it("reports every missing required variable when enabled", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "true",
    });
    expect(config.digitalEnabled).toBe(true);
    expect(config.configValid).toBe(false);
    const named = config.problems.map((problem) => problem.variable);
    expect(named).toEqual([
      "DATABASE_URL",
      "AUTH_SECRET",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_ID",
      "APP_URL",
    ]);
  });

  it("is config-valid when enabled with every required variable present", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "true",
      ...CLOUD_ENABLED_VARS,
    });
    expect(config.configValid).toBe(true);
    expect(config.digitalEnabled).toBe(true);
    expect(config.problems).toEqual([]);
  });

  it("requires an https APP_URL in cloud", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "true",
      ...CLOUD_ENABLED_VARS,
      APP_URL: "http://toddlebook.example",
    });
    expect(config.configValid).toBe(false);
    expect(config.problems).toEqual([
      { variable: "APP_URL", detail: "must use https in cloud mode" },
    ]);
  });

  it("rejects an unparseable CLOUD_APP_ENABLED as a config problem, not a launch state", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "maybe",
    });
    expect(config.configValid).toBe(false);
    expect(config.digitalEnabled).toBe(false);
    expect(config.launchDisabled).toBe(false);
    expect(config.problems).toEqual([
      {
        variable: "CLOUD_APP_ENABLED",
        detail:
          'must be "true" or "false"; the digital surface stays disabled until it parses',
      },
    ]);
  });

  it("rejects a non-numeric SMTP_PORT", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "true",
      ...CLOUD_ENABLED_VARS,
      SMTP_PORT: "smtp",
    });
    expect(config.configValid).toBe(false);
    expect(config.problems).toEqual([
      { variable: "SMTP_PORT", detail: "must be a numeric port" },
    ]);
  });

  it("does not require digital variables while launch-disabled", () => {
    const config = parseRuntimeConfig({ DEPLOYMENT_MODE: "cloud" });
    expect(config.configValid).toBe(true);
    expect(config.problems).toEqual([]);
  });
});

describe("parseRuntimeConfig — selfhost (FR-40/FR-44)", () => {
  it("requires DATABASE_URL, AUTH_SECRET and APP_URL", () => {
    const config = parseRuntimeConfig({ DEPLOYMENT_MODE: "selfhost" });
    expect(config.mode).toEqual({ known: true, value: "selfhost" });
    expect(config.digitalEnabled).toBe(true);
    expect(config.configValid).toBe(false);
    expect(config.problems.map((problem) => problem.variable)).toEqual([
      "DATABASE_URL",
      "AUTH_SECRET",
      "APP_URL",
    ]);
  });

  it("ignores CLOUD_APP_ENABLED entirely", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "selfhost",
      CLOUD_APP_ENABLED: "garbage",
    });
    expect(config.configValid).toBe(false);
    expect(config.problems.map((problem) => problem.variable)).toEqual([
      "DATABASE_URL",
      "AUTH_SECRET",
      "APP_URL",
    ]);
  });

  it("is config-valid with the required variables and accepts http APP_URL", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "selfhost",
      DATABASE_URL: "postgres://placeholder",
      AUTH_SECRET: "placeholder-secret",
      APP_URL: "http://toddlebook.local:3000",
    });
    expect(config.configValid).toBe(true);
    expect(config.problems).toEqual([]);
  });

  it("does not require SMTP or Stripe variables", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "selfhost",
      DATABASE_URL: "postgres://placeholder",
      AUTH_SECRET: "placeholder-secret",
      APP_URL: "https://toddlebook.local",
      STRIPE_SECRET_KEY: "irrelevant-in-selfhost",
    });
    expect(config.configValid).toBe(true);
    expect(config.problems).toEqual([]);
  });
});

describe("parseRuntimeConfig — no value leakage", () => {
  it("problem entries carry only variable names and fixed details, never values", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "true",
      DATABASE_URL: "postgres://user:super-secret-password@db.example:5432/db",
      AUTH_SECRET: "super-secret-auth",
      APP_URL: "http://toddlebook.example",
    });
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("super-secret-password");
    expect(serialized).not.toContain("super-secret-auth");
    // The offending values are not echoed even for invalid entries.
    expect(
      config.problems.find((problem) => problem.variable === "APP_URL")?.detail,
    ).toBe("must use https in cloud mode");
  });

  it("never echoes an invalid CLOUD_APP_ENABLED value", () => {
    const config = parseRuntimeConfig({
      DEPLOYMENT_MODE: "cloud",
      CLOUD_APP_ENABLED: "s3cr3t-typo",
    });
    expect(JSON.stringify(config)).not.toContain("s3cr3t-typo");
  });
});
