// Import-boundary guardrail (ARCH-002 developer guardrails; FR-02;
// issue #22 verification): the `/` render graph must import no database,
// auth, billing, care or `/app` server module. Digital modules initialize
// lazily and are reachable only from server-side digital code (nitro route
// handlers, future /app routes).
//
// Allowed server-side import in the root document: the pure
// environment-reading render-flag module (server-flags) behind
// createServerFn — blessed by the tech-lead readiness comment on #22
// ("a pure environment-reading config module is acceptable only if it is
// server-only and ships no env values to the client bundle").
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FREE_ROUTE_FILES = [
  join("src", "routes", "index.tsx"),
  join("src", "routes", "__root.tsx"),
] as const;

const DIGITAL_MODULE_PATTERN =
  /server\/(db|auth|billing|care)|routes\/app|better-auth|stripe|drizzle-orm|^pg$/;

/** The only server module the free render graph may import. */
const ALLOWED_SERVER_IMPORTS = new Set(["../server/server-flags"]);

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromPattern = /from\s+["']([^"']+)["']/g;
  const sideEffectPattern = /^\s*import\s+["']([^"']+)["']/gm;
  for (const match of source.matchAll(fromPattern)) {
    specifiers.push(match[1] as string);
  }
  for (const match of source.matchAll(sideEffectPattern)) {
    specifiers.push(match[1] as string);
  }
  return specifiers;
}

describe("/ render-graph import boundary (ARCH-002 guardrail)", () => {
  for (const file of FREE_ROUTE_FILES) {
    it(`${file} imports no database, auth, billing, care or /app module`, () => {
      const source = readFileSync(file, "utf8");
      const specifiers = importSpecifiers(source);
      expect(specifiers.length).toBeGreaterThan(0);
      const offending = specifiers.filter((specifier) =>
        DIGITAL_MODULE_PATTERN.test(specifier),
      );
      expect(offending).toEqual([]);
    });
  }

  it("the root document's only server import is the render-flag module", () => {
    const source = readFileSync(FREE_ROUTE_FILES[1] as string, "utf8");
    const specifiers = importSpecifiers(source);
    const serverImports = specifiers.filter((specifier) =>
      /server\//.test(specifier),
    );
    expect(serverImports).toEqual([...ALLOWED_SERVER_IMPORTS]);
  });

  it("the free route imports no server module at all", () => {
    const source = readFileSync(FREE_ROUTE_FILES[0] as string, "utf8");
    const specifiers = importSpecifiers(source);
    expect(
      specifiers.filter((specifier) => /server\//.test(specifier)),
    ).toEqual([]);
  });
});
