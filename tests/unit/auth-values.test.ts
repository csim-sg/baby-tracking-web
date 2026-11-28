// Unit tests for the nickname rule and the rate-limit key derivation
// (issue #24; FR-12; ADR-002 §1 control 2 — no email/IP in clear).
import { describe, expect, it } from "vitest";

import { validateNickname } from "../../src/server/care/children";
import { rateLimitKey } from "../../src/server/auth/rate-limit";

describe("validateNickname (FR-12: 1–40 characters)", () => {
  it("accepts 1–40 characters after trimming", () => {
    expect(validateNickname("Mia")).toEqual({ nickname: "Mia" });
    expect(validateNickname("  Mia  ")).toEqual({ nickname: "Mia" });
    expect(validateNickname("a")).toEqual({ nickname: "a" });
    expect(validateNickname("b".repeat(40))).toEqual({
      nickname: "b".repeat(40),
    });
  });

  it("rejects empty/blank input", () => {
    expect(validateNickname("")).toHaveProperty("problem");
    expect(validateNickname("   ")).toHaveProperty("problem");
    expect(validateNickname(undefined)).toHaveProperty("problem");
    expect(validateNickname(42)).toHaveProperty("problem");
  });

  it("rejects more than 40 characters", () => {
    expect(validateNickname("c".repeat(41))).toHaveProperty("problem");
  });
});

describe("rateLimitKey (ADR-002 §1 control 2 storage rules)", () => {
  it("is a deterministic SHA-256 hex digest", () => {
    const key = rateLimitKey("sign-in:ip", "203.0.113.7");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(rateLimitKey("sign-in:ip", "203.0.113.7")).toBe(key);
  });

  it("differs by scope and identifier", () => {
    expect(rateLimitKey("sign-in:ip", "1.2.3.4")).not.toBe(
      rateLimitKey("sign-in:id", "1.2.3.4"),
    );
    expect(rateLimitKey("sign-in:ip", "1.2.3.4")).not.toBe(
      rateLimitKey("sign-in:ip", "5.6.7.8"),
    );
  });

  it("never contains the identifier in clear", () => {
    const key = rateLimitKey("password-reset:id", "owner@example.com");
    expect(key).not.toContain("owner@example.com");
    expect(key).not.toContain("@");
    expect(key).not.toContain(".");
  });
});
