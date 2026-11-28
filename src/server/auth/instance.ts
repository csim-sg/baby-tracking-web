/**
 * The runtime Better Auth 1.7.28 instance (issue #24; ADR-002 §1; FR-05–
 * FR-08). ONE auth implementation serves both modes.
 *
 * The instance is lazily created on first digital use and anchored on
 * `globalThis` (mirrors the #22/#23 registry/pool pattern: shared server
 * modules can be emitted into more than one server graph, and duplicate
 * instances would double timers and break instance identity).
 *
 * The schema-relevant options come from `baseAuthOptions` — the SAME builder
 * the migration runner uses — so the migrated auth table set
 * (`user`, `session`, `account`, `verification`) cannot drift from the
 * runtime instance. Everything added here is behavior-only (callbacks,
 * lifetimes, cookie attributes); this is guarded by
 * tests/unit/auth-options.test.ts and the integration schema assertion.
 *
 * The library's HTTP router is NOT mounted (T1 F4 proved it cannot be on
 * this stack): every auth action goes through `auth.api.*` inside TanStack
 * Start server functions, wrapped by the application-boundary controls in
 * `origin.ts` / `rate-limit.ts` / `guard.ts` (ADR-002 §1 controls 1–4).
 */

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getDatabasePool } from "../db/pool";
import { baseAuthOptions } from "./base-options";
import { emailVerificationRequired } from "./mailer";
import {
  RESET_TOKEN_EXPIRES_IN_SECONDS,
  VERIFICATION_EXPIRES_IN_SECONDS,
} from "./base-options";
import { sendResetEmail, sendVerificationEmail } from "./mailer";

/**
 * The configured `APP_URL` as a URL, or null when absent/invalid. The
 * runtime-config layer treats a broken APP_URL as a readiness problem; this
 * helper only avoids throwing at import time.
 */
export function appUrl(env: Record<string, string | undefined> = process.env): URL | null {
  const raw = env.APP_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** True when `APP_URL` is HTTPS — drives the cookie `Secure` attribute. */
export function appUrlIsHttps(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return appUrl(env)?.protocol === "https:";
}

/**
 * Origins the library may consider trusted for its own (HTTP-router-only)
 * checks. The APPLICATION same-origin guard (`origin.ts`) is the enforcing
 * control on this stack; this list keeps the library consistent for any
 * path where its validation does engage.
 */
function trustedOrigins(): string[] {
  const origins = new Set<string>();
  const app = appUrl();
  if (app) {
    origins.add(app.origin);
    if (app.protocol === "http:" && app.hostname === "localhost") {
      origins.add("http://127.0.0.1:" + app.port);
    }
    if (app.protocol === "http:" && app.hostname === "127.0.0.1") {
      origins.add("http://localhost:" + app.port);
    }
  }
  return [...origins];
}

/**
 * Builds the full runtime options. Exported for tests (cookie/verification/
 * revocation-relevant assertions) and for the operator tooling.
 */
export function buildRuntimeAuthOptions(): BetterAuthOptions {
  const verificationRequired = emailVerificationRequired();
  const base = baseAuthOptions(getDatabasePool());
  const options: BetterAuthOptions = {
    ...base,
    baseURL: appUrl()?.toString() ?? "http://127.0.0.1:3000",
    trustedOrigins: trustedOrigins(),
    emailAndPassword: {
      ...base.emailAndPassword,
      enabled: true,
      // FR-06: cloud requires verified email; self-host verifies only when
      // SMTP is configured. Without SMTP, sign-up completes without
      // verification and the operator reset command is the recovery path.
      requireEmailVerification: verificationRequired,
      // With verification off (self-host, no SMTP), a completed sign-up
      // issues the session directly.
      autoSignIn: !verificationRequired,
      // FR-07: single-use reset token, 60 minutes.
      resetPasswordTokenExpiresIn: RESET_TOKEN_EXPIRES_IN_SECONDS,
      // Reset mail rewrites the library URL (which points at the gated,
      // never-mounted /api/auth/reset-password/<token> path) into the app's
      // own /reset-password page; the token is delivered as a query value.
      sendResetPassword: async ({ user, token }) => {
        const base = appUrl()?.origin ?? "";
        await sendResetEmail(
          user.email,
          `${base}/reset-password?token=${encodeURIComponent(token)}`,
        );
      },
    },
    emailVerification: {
      // FR-06: verification links expire after 24 hours.
      expiresIn: VERIFICATION_EXPIRES_IN_SECONDS,
      sendOnSignUp: verificationRequired,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, token }) => {
        const base = appUrl()?.origin ?? "";
        await sendVerificationEmail(
          user.email,
          `${base}/verify-email?token=${encodeURIComponent(token)}`,
        );
      },
    },
    session: base.session,
    advanced: {
      // ADR-002 §1 control 4: `Secure` whenever APP_URL is HTTPS (always in
      // cloud); explicit attributes otherwise (HttpOnly + SameSite=Lax are
      // also library defaults — pinned here so the security posture does not
      // depend on defaults).
      useSecureCookies: appUrlIsHttps(),
      cookies: {
        session_token: {
          attributes: {
            httpOnly: true,
            sameSite: "lax",
            path: "/",
          },
        },
      },
    },
    // T1 F4: the library limiter only runs in its HTTP router, which is not
    // mounted on this stack. It stays OFF here; ADR-002 §1 control 2's
    // PostgreSQL-backed limiter is implemented in ./rate-limit.ts.
    rateLimit: {
      enabled: false,
    },
  };
  return options;
}

type GlobalWithAuth = typeof globalThis & {
  /** Process-wide lazily created auth instance, shared by every copy. */
  __toddlebook_auth_instance__?: ReturnType<typeof betterAuth>;
};

/**
 * Returns the process-wide auth instance, creating it on first use. `/` and
 * `/healthz` never call this — the instance (and its imports) stay out of
 * the free render path (FR-02; ARCH-002 lazy initialization).
 */
export function getAuthInstance(): ReturnType<typeof betterAuth> {
  const store = globalThis as GlobalWithAuth;
  const existing = store.__toddlebook_auth_instance__;
  if (existing) {
    return existing;
  }
  const created = betterAuth(buildRuntimeAuthOptions());
  store.__toddlebook_auth_instance__ = created;
  return created;
}
