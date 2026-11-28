// Unit tests for the application-boundary same-origin guard (issue #24;
// ADR-002 §1 control 1; AC-02/TR-13 — every non-GET server function must
// reject missing/invalid origins).
import { describe, expect, it } from "vitest";

import {
  allowedOrigins,
  originIsAllowed,
  requestOrigin,
} from "../../src/server/auth/origin";

const APP_URL = "https://toddlebook.example";

function headersWith(entries: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(entries)) {
    headers.set(key, value);
  }
  return headers;
}

describe("allowedOrigins (APP_URL allowlist)", () => {
  it("allows exactly the configured APP_URL origin", () => {
    expect(allowedOrigins({ APP_URL })).toEqual([APP_URL]);
  });

  it("adds the localhost twin only for a plain-HTTP LOCAL app URL", () => {
    expect(allowedOrigins({ APP_URL: "http://localhost:4173" })).toEqual([
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ]);
    expect(
      allowedOrigins({ APP_URL: "https://toddlebook.example" }),
    ).not.toContain("http://localhost");
  });

  it("is empty when APP_URL is missing or invalid", () => {
    expect(allowedOrigins({})).toEqual([]);
    expect(allowedOrigins({ APP_URL: "not a url" })).toEqual([]);
  });
});

describe("requestOrigin (Origin with Referer fallback)", () => {
  it("prefers Origin", () => {
    expect(
      requestOrigin(
        headersWith({ origin: "https://toddlebook.example", referer: "https://x.example/r" }),
      ),
    ).toBe("https://toddlebook.example");
  });

  it("falls back to the Referer origin when Origin is absent", () => {
    expect(
      requestOrigin(headersWith({ referer: "https://toddlebook.example/sign-in" })),
    ).toBe("https://toddlebook.example");
  });

  it("returns null for missing/blank/invalid values", () => {
    expect(requestOrigin(headersWith({}))).toBeNull();
    expect(requestOrigin(headersWith({ origin: "  " }))).toBeNull();
    expect(requestOrigin(headersWith({ referer: "::not a url" }))).toBeNull();
  });
});

describe("originIsAllowed (mutation gate)", () => {
  const env = { APP_URL };

  it("accepts the exact allowed origin", () => {
    expect(
      originIsAllowed(
        APP_URL,
        headersWith({ host: "toddlebook.example", origin: APP_URL }),
        env,
      ),
    ).toBe(true);
  });

  it("rejects a missing origin (never trusted)", () => {
    expect(originIsAllowed(null, headersWith({}), env)).toBe(false);
  });

  it("rejects foreign origins (the CSRF forged-origin case)", () => {
    expect(
      originIsAllowed(
        "https://evil.example",
        headersWith({ origin: "https://evil.example" }),
        env,
      ),
    ).toBe(false);
  });

  it("rejects a lookalike scheme/host", () => {
    expect(
      originIsAllowed(
        "http://toddlebook.example",
        headersWith({ host: "toddlebook.example" }),
        env,
      ),
    ).toBe(false);
    expect(
      originIsAllowed(
        "https://toddlebook.example.evil.example",
        headersWith({ origin: "https://toddlebook.example.evil.example" }),
        env,
      ),
    ).toBe(false);
  });

  it("does not require the Host header to equal the origin (proxied topologies)", () => {
    expect(
      originIsAllowed(
        APP_URL,
        headersWith({ host: "internal:3000", origin: APP_URL }),
        env,
      ),
    ).toBe(true);
  });

  it("honors a non-default port", () => {
    const localEnv = { APP_URL: "http://127.0.0.1:4173" };
    expect(
      originIsAllowed(
        "http://127.0.0.1:4173",
        headersWith({ host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" }),
        localEnv,
      ),
    ).toBe(true);
    expect(
      originIsAllowed(
        "http://127.0.0.1:9999",
        headersWith({ host: "127.0.0.1:4173" }),
        localEnv,
      ),
    ).toBe(false);
  });
});
