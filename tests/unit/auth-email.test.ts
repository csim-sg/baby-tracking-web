// Unit tests for the application-boundary email/URL normalization rules
// (issue #24; FR-05; ADR-002 §1 control 4; spike F9).
import { describe, expect, it } from "vitest";

import {
  isLocalReturnPath,
  looksLikeEmail,
  normalizeEmail,
  safeReturnPath,
} from "../../src/server/auth/email";

describe("normalizeEmail (FR-05 trim + lowercase; spike F9)", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeEmail("  Owner@Example.COM \n")).toBe("owner@example.com");
    expect(normalizeEmail("Mixed@Case.Example")).toBe("mixed@case.example");
  });

  it("leaves already-normalized input unchanged", () => {
    expect(normalizeEmail("plain@example.com")).toBe("plain@example.com");
  });
});

describe("looksLikeEmail (boundary shape check)", () => {
  it("accepts ordinary addresses", () => {
    expect(looksLikeEmail("owner@example.com")).toBe(true);
    expect(looksLikeEmail("first.last+tag@sub.example.co")).toBe(true);
  });

  it("rejects non-emails", () => {
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail("not-an-email")).toBe(false);
    expect(looksLikeEmail("two@at@signs@example.com")).toBe(false);
    expect(looksLikeEmail("missing-tld@example")).toBe(false);
    expect(looksLikeEmail("space in@example.com")).toBe(false);
  });
});

describe("isLocalReturnPath / safeReturnPath (local-path allowlist)", () => {
  it("accepts plain local paths", () => {
    expect(isLocalReturnPath("/app")).toBe(true);
    expect(isLocalReturnPath("/app/settings")).toBe(true);
    expect(isLocalReturnPath("/")).toBe(true);
  });

  it("rejects absolute URLs, protocol-relative paths, schemes and tricks", () => {
    expect(isLocalReturnPath("https://evil.example/app")).toBe(false);
    expect(isLocalReturnPath("//evil.example")).toBe(false);
    expect(isLocalReturnPath("/\\evil.example")).toBe(false);
    expect(isLocalReturnPath("javascript:alert(1)")).toBe(false);
    expect(isLocalReturnPath("/redirect?to=https://evil.example")).toBe(false);
    expect(isLocalReturnPath("app")).toBe(false);
    expect(isLocalReturnPath("")).toBe(false);
    expect(isLocalReturnPath("/x\r\nSet-Cookie: 1")).toBe(false);
    expect(isLocalReturnPath(`/${"a".repeat(600)}`)).toBe(false);
  });

  it("safeReturnPath falls back when the input is not a local path", () => {
    expect(safeReturnPath("/app/settings", "/app")).toBe("/app/settings");
    expect(safeReturnPath("https://evil.example", "/app")).toBe("/app");
    expect(safeReturnPath(undefined, "/app")).toBe("/app");
  });
});
