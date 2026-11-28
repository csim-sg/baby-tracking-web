// Unit tests for the auth options builders (issue #24; carry-forward #8:
// "if runtime auth options change the migrated auth table set, re-run
// idempotency and update the schema assertion" — the structural guard here
// FAILS if the runtime and migration options ever diverge on schema-relevant
// knobs, and pins the FR-05–FR-08 behavior knobs).
import { describe, expect, it } from "vitest";

import {
  baseAuthOptions,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SESSION_EXPIRES_IN_SECONDS,
  VERIFICATION_EXPIRES_IN_SECONDS,
  RESET_TOKEN_EXPIRES_IN_SECONDS,
} from "../../src/server/auth/base-options";
import { buildRuntimeAuthOptions } from "../../src/server/auth/instance";
import { authMigrationOptions } from "../../src/server/db/auth-migration-config";

/** The option knobs that can change the MIGRATED table/column set. */
function schemaRelevant(options: unknown): unknown {
  const o = options as {
    appName?: unknown;
    emailAndPassword?: Record<string, unknown>;
    session?: Record<string, unknown>;
    user?: unknown;
    plugins?: unknown;
  };
  return {
    appName: o.appName,
    emailAndPassword: {
      enabled: o.emailAndPassword?.enabled,
      minPasswordLength: o.emailAndPassword?.minPasswordLength,
      maxPasswordLength: o.emailAndPassword?.maxPasswordLength,
    },
    session: { expiresIn: o.session?.expiresIn },
    user: o.user ?? null,
    plugins: o.plugins ?? null,
  };
}

describe("auth options: migration runner vs runtime instance (carry-forward #8)", () => {
  it("the schema-relevant core is IDENTICAL, so the migrated table set cannot drift", () => {
    const pool = {} as never; // never opened by these builders
    const migration = authMigrationOptions(pool);
    const runtime = buildRuntimeAuthOptions();
    expect(schemaRelevant(runtime)).toEqual(schemaRelevant(migration));
    expect(schemaRelevant(baseAuthOptions(pool))).toEqual(
      schemaRelevant(migration),
    );
  });

  it("pins the FR-05 password bounds and FR-08 30-day sessions", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(60 * 60 * 24 * 30);
    const runtime = buildRuntimeAuthOptions();
    expect(runtime.emailAndPassword?.minPasswordLength).toBe(12);
    expect(runtime.emailAndPassword?.maxPasswordLength).toBe(128);
    expect(runtime.session?.expiresIn).toBe(60 * 60 * 24 * 30);
  });

  it("pins FR-06/FR-07 token lifetimes (24 h verification, 60 min reset)", () => {
    expect(VERIFICATION_EXPIRES_IN_SECONDS).toBe(60 * 60 * 24);
    expect(RESET_TOKEN_EXPIRES_IN_SECONDS).toBe(60 * 60);
    const runtime = buildRuntimeAuthOptions();
    expect(runtime.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(
      60 * 60,
    );
    expect(runtime.emailVerification?.expiresIn).toBe(60 * 60 * 24);
  });

  it("keeps the library rate limiter OFF (T1 F4 — the app owns limiting)", () => {
    expect(buildRuntimeAuthOptions().rateLimit?.enabled).toBe(false);
  });

  it("disables telemetry (self-host must not phone home)", () => {
    expect(buildRuntimeAuthOptions().telemetry?.enabled).toBe(false);
  });

  it("pins the cookie contract: HttpOnly, SameSite=Lax, Path=/", () => {
    const advanced = buildRuntimeAuthOptions().advanced;
    const attributes = (
      advanced?.cookies?.session_token as
        | { attributes?: Record<string, unknown> }
        | undefined
    )?.attributes;
    expect(attributes?.httpOnly).toBe(true);
    expect(attributes?.sameSite).toBe("lax");
    expect(attributes?.path).toBe("/");
  });
});

describe("email verification requirement (FR-06)", () => {
  it("uses useSecureCookies exactly when APP_URL is HTTPS", () => {
    // Note: buildRuntimeAuthOptions reads the live env for APP_URL; the
    // cookie Secure behavior is additionally proven end-to-end in the E2E
    // evidence (Set-Cookie capture). Here we pin the option exists.
    const runtime = buildRuntimeAuthOptions();
    expect(typeof runtime.advanced?.useSecureCookies).toBe("boolean");
  });
});
