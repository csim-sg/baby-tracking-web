/**
 * Auth server functions (issue #24; FR-05–FR-08; ADR-002 §1; SPEC §Server
 * operations error envelope).
 *
 * TanStack Start server functions are the ONLY auth transport (T1 F4: the
 * library HTTP router cannot be mounted on this stack; `/api/auth/**` stays
 * nitro-gated). Every function here:
 * - GET: readiness gate only (no mutation, no origin requirement);
 * - POST (mutation): `guardMutation()` — readiness → same-origin → body
 *   bound — then the action's per-IP and per-email/action rate limits, then
 *   the Better Auth API call with `returnHeaders: true` so its Set-Cookie
 *   values reach the browser via `applyAuthSetCookies` (spike F1).
 *
 * Error contract: expected outcomes are RETURNED as the SPEC error envelope
 * (`{ ok: false, error: { code, message, fields? } }`); only guards throw
 * `Response`s (fail-closed 503/404, 403 origin, 429 rate limit) because the
 * router/SSR layer must send those statuses verbatim.
 *
 * Non-disclosure rules (FR-05/AC): duplicate email answers with the SAME
 * generic response shape for every signup in the current mode — the
 * verification-mode shape is the library's own generic duplicate response
 * (F7), and the no-verification shape is identical for new and existing
 * accounts. No email addresses or tokens are logged anywhere.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { getDatabasePool } from "../db/pool";
import {
  applyAuthSetCookies,
  emailVerificationCurrentlyRequired,
  enforceRateLimits,
  guardMutation,
  revokeAllSessionsForUser,
  setDocumentSecurityHeaders,
} from "./guard";
import { appUrl, getAuthInstance } from "./instance";
import { normalizeEmail, looksLikeEmail } from "./email";

type EnvelopeError = {
  code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "VALIDATION"
    | "LIMIT"
    | "RATE_LIMITED"
    | "DEPENDENCY_UNAVAILABLE"
    | "INTERNAL";
  message: string;
  fields?: Record<string, string>;
};

export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: EnvelopeError };

export type SessionView = {
  user: { id: string; email: string; emailVerified: boolean };
  session: { expiresAt: string };
} | null;

function validationError(fields: Record<string, string>): Envelope<never> {
  return {
    ok: false,
    error: { code: "VALIDATION", message: "Please check the form.", fields },
  };
}

function genericError(): Envelope<never> {
  return {
    ok: false,
    error: { code: "INTERNAL", message: "Something went wrong. Try again." },
  };
}

/** Maps a Better Auth APIError to a non-distinguishing envelope. */
function authErrorEnvelope(statusName: string | undefined, fallback: string): Envelope<never> {
  switch (statusName) {
    case "UNAUTHORIZED":
    case "INVALID_EMAIL_OR_PASSWORD":
      return {
        ok: false,
        error: { code: "UNAUTHENTICATED", message: "Invalid email or password." },
      };
    case "FORBIDDEN":
    case "EMAIL_NOT_VERIFIED":
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Please verify your email before signing in.",
        },
      };
    default:
      return { ok: false, error: { code: "INTERNAL", message: fallback } };
  }
}

function requestHeaders(): Headers {
  const request = getRequest();
  return new Headers(request?.headers ?? {});
}

/** Applies Set-Cookie values whether the endpoint returned headers or a Response. */
function cookiesFromOutcome(outcome: unknown): void {
  if (outcome instanceof Response) {
    for (const cookie of outcome.headers.getSetCookie()) {
      setResponseHeader("Set-Cookie", cookie);
    }
    return;
  }
  const headers = (outcome as { headers?: Headers }).headers;
  if (headers instanceof Headers) {
    applyAuthSetCookies(headers);
  }
}

async function readSession(): Promise<SessionView> {
  const auth = getAuthInstance();
  try {
    const session = await auth.api.getSession({ headers: requestHeaders() });
    if (!session?.user) {
      return null;
    }
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      },
      session: { expiresAt: session.session.expiresAt.toISOString() },
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET functions (readiness gate; no mutation)
// ---------------------------------------------------------------------------

/** The current session view, or null. Server-side only (DB-backed). */
export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionView> => readSession(),
);

/** Derived auth capabilities for pages (booleans only — never env values). */
export type AuthFlags = {
  verificationRequired: boolean;
};

export const getAuthFlags = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthFlags> => ({
    verificationRequired: emailVerificationCurrentlyRequired(),
  }),
);

/**
 * The /app gate data: session + capabilities in one server round trip.
 * Returns the gate payload when the surface is unavailable; the route's
 * beforeLoad throws it as a verbatim Response.
 */
export type AppGate =
  | { kind: "unauthenticated" }
  | { kind: "unverified"; email: string }
  | {
      kind: "ok";
      session: NonNullable<SessionView>;
      verificationRequired: boolean;
    };

export const getAppGate = createServerFn({ method: "GET" }).handler(
  async (): Promise<AppGate> => {
    // Readiness/launch gating happens in the request middleware
    // (src/server/digital-request-middleware.ts); this function resolves the
    // SESSION boundary only. The TR-14 headers are applied by the middleware.
    setDocumentSecurityHeaders("app");
    const session = await readSession();
    if (!session) {
      return { kind: "unauthenticated" };
    }
    const verificationRequired = emailVerificationCurrentlyRequired();
    if (verificationRequired && !session.user.emailVerified) {
      return { kind: "unverified", email: session.user.email };
    }
    return { kind: "ok", session, verificationRequired };
  },
);

// ---------------------------------------------------------------------------
// POST functions (mutations: guard → rate limit → auth API)
// ---------------------------------------------------------------------------

function normalizeInputEmail(raw: unknown): string {
  return typeof raw === "string" ? normalizeEmail(raw) : "";
}

export type SignUpResult = Envelope<{
  /** Response shape depends only on the mode, never on account existence. */
  message: string;
}>;

/**
 * Sign-up (FR-05). Email trimmed + lowercased at this boundary (F9);
 * password 12–128 enforced by the library. The generic response shape is
 * uniform per mode (non-disclosure, F7/C08).
 */
export const signUp = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { email?: string; password?: string })
  .handler(async ({ data }): Promise<SignUpResult> => {
    await guardMutation();
    const email = normalizeInputEmail(data.email);
    const password = typeof data.password === "string" ? data.password : "";
    const fields: Record<string, string> = {};
    if (!looksLikeEmail(email)) {
      fields.email = "Enter a valid email address.";
    }
    if (password.length < 12 || password.length > 128) {
      fields.password = "Password must be 12–128 characters.";
    }
    if (Object.keys(fields).length > 0) {
      return validationError(fields);
    }
    await enforceRateLimits("sign-up", email);

    const auth = getAuthInstance();
    try {
      const outcome = await auth.api.signUpEmail({
        body: { email, password, name: "" },
        headers: requestHeaders(),
        returnHeaders: true,
      });
      cookiesFromOutcome(outcome);
      const verificationRequired = emailVerificationCurrentlyRequired();
      return {
        ok: true,
        data: {
          message: verificationRequired
            ? "Check your inbox to verify your email, then sign in."
            : "Your account is ready — sign in to continue.",
        },
      };
    } catch (error) {
      const e = error as {
        status?: string | number;
        code?: string;
        body?: { code?: string };
      };
      // F7: with verification required, duplicates already return a generic
      // ok response; any USER_ALREADY_EXISTS arriving here (no-verification
      // mode) maps to the SAME generic shape a new account gets. The
      // library's own message names the existence — never surfaced.
      const code = e.code ?? e.body?.code ?? "";
      if (code.includes("USER_ALREADY_EXISTS")) {
        return {
          ok: true,
          data: { message: "Your account is ready — sign in to continue." },
        };
      }
      if (typeof e.status === "string" || typeof e.status === "number") {
        return authErrorEnvelope(
          typeof e.status === "string" ? e.status : undefined,
          "Sign-up failed. Try again.",
        );
      }
      return genericError();
    }
  });

export type SignInResult = Envelope<{ email: string }>;

/** Sign-in (FR-05/FR-06). Unverified cloud sign-ins are blocked by the library. */
export const signIn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { email?: string; password?: string })
  .handler(async ({ data }): Promise<SignInResult> => {
    await guardMutation();
    const email = normalizeInputEmail(data.email);
    const password = typeof data.password === "string" ? data.password : "";
    const fields: Record<string, string> = {};
    if (!looksLikeEmail(email)) {
      fields.email = "Enter a valid email address.";
    }
    if (password.length === 0) {
      fields.password = "Enter your password.";
    }
    if (Object.keys(fields).length > 0) {
      return validationError(fields);
    }
    await enforceRateLimits("sign-in", email);

    const auth = getAuthInstance();
    try {
      const outcome = await auth.api.signInEmail({
        body: { email, password },
        headers: requestHeaders(),
        returnHeaders: true,
      });
      cookiesFromOutcome(outcome);
      return { ok: true, data: { email } };
    } catch (error) {
      const e = error as { status?: string | number; code?: string };
      if (typeof e.status === "string" || typeof e.status === "number") {
        return authErrorEnvelope(
          typeof e.status === "string" ? e.status : undefined,
          "Sign-in failed. Try again.",
        );
      }
      return genericError();
    }
  });

export type SignOutResult = Envelope<{ signedOut: boolean }>;

/** Sign out the current session (FR-08): cookie cleared, session row deleted. */
export const signOut = createServerFn({ method: "POST" }).handler(
  async (): Promise<SignOutResult> => {
    await guardMutation();
    const auth = getAuthInstance();
    try {
      const outcome = await auth.api.signOut({
        headers: requestHeaders(),
        returnHeaders: true,
      });
      cookiesFromOutcome(outcome);
      return { ok: true, data: { signedOut: true } };
    } catch {
      return genericError();
    }
  },
);

export type SignOutAllResult = Envelope<{ revoked: boolean }>;

/** Sign out ALL sessions (FR-08) via the library's `revokeSessions` (F8). */
export const signOutAll = createServerFn({ method: "POST" }).handler(
  async (): Promise<SignOutAllResult> => {
    await guardMutation();
    const auth = getAuthInstance();
    try {
      const outcome = await auth.api.revokeSessions({
        headers: requestHeaders(),
        returnHeaders: true,
      });
      cookiesFromOutcome(outcome);
      return { ok: true, data: { revoked: true } };
    } catch {
      return genericError();
    }
  },
);

export type ForgotPasswordResult = Envelope<{
  /** Identical whether or not the account exists (non-disclosure). */
  message: string;
}>;

/**
 * Password reset request (FR-07). Rate-limited per IP and per email; the
 * response never confirms existence. SMTP absent (self-host no-SMTP):
 * no mail can be sent — the generic message points at the operator reset
 * command limitation instead, still without existence disclosure.
 */
export const forgotPassword = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { email?: string })
  .handler(async ({ data }): Promise<ForgotPasswordResult> => {
    await guardMutation();
    const email = normalizeInputEmail(data.email);
    if (!looksLikeEmail(email)) {
      return validationError({ email: "Enter a valid email address." });
    }
    await enforceRateLimits("password-reset", email);

    const smtpConfigured = emailVerificationCurrentlyRequired();
    if (!smtpConfigured) {
      return {
        ok: true,
        data: {
          message:
            "This instance does not send email. If the account exists, its password can only be reset by the operator's recovery command.",
        },
      };
    }
    const auth = getAuthInstance();
    try {
      const base = appUrl()?.origin ?? "";
      await auth.api.requestPasswordReset({
        body: {
          email,
          redirectTo: `${base}/reset-password`,
        },
        headers: requestHeaders(),
        returnHeaders: true,
      });
    } catch {
      // Swallowed: the generic response below never confirms existence.
    }
    return {
      ok: true,
      data: {
        message:
          "If an account exists for that email, a reset link has been sent. The link works once and expires in 60 minutes.",
      },
    };
  });

export type ResetPasswordResult = Envelope<{ reset: boolean }>;

/**
 * Resolves the user a reset token belongs to by reading the library-owned
 * `verification` row BEFORE the (single-use, row-deleting) reset consumes
 * it. Better Auth writes reset verification rows as
 * `identifier = "reset-password:<token>"`, `value = <userId>` — the same
 * shape the spike recorded (C19/C21). This plumbing exists solely so
 * FR-07's "reset revokes existing sessions" can target the right user when
 * the flow carries no session. Returns null when no live row matches.
 */
async function userIdForResetToken(token: string): Promise<string | null> {
  try {
    const result = await getDatabasePool().query(
      'SELECT "value" FROM "verification" WHERE "identifier" = $1 AND "expiresAt" > now() LIMIT 1',
      [`reset-password:${token}`],
    );
    const value = result.rows[0]?.value;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Password reset completion (FR-07): single-use token, then EVERY session
 * of the user is revoked (F6 pairing; SPEC-sanctioned user-ID revocation).
 */
export const resetPassword = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { token?: string; newPassword?: string })
  .handler(async ({ data }): Promise<ResetPasswordResult> => {
    await guardMutation();
    const token = typeof data.token === "string" ? data.token : "";
    const newPassword =
      typeof data.newPassword === "string" ? data.newPassword : "";
    const fields: Record<string, string> = {};
    if (token.trim() === "") {
      fields.token = "This reset link is missing its token.";
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      fields.newPassword = "Password must be 12–128 characters.";
    }
    if (Object.keys(fields).length > 0) {
      return validationError(fields);
    }

    const tokenUserId = await userIdForResetToken(token);
    const auth = getAuthInstance();
    try {
      const outcome = await auth.api.resetPassword({
        body: { newPassword, token },
        headers: requestHeaders(),
        returnHeaders: true,
      });
      cookiesFromOutcome(outcome);
      // F6 pairing: reset success must revoke existing sessions. The token
      // flow may carry no session, so revoke by user ID (SPEC-sanctioned).
      if (tokenUserId) {
        await revokeAllSessionsForUser(tokenUserId);
      }
      return { ok: true, data: { reset: true } };
    } catch (error) {
      const e = error as { status?: string | number; code?: string };
      if (e.code === "INVALID_TOKEN" || e.status === "BAD_REQUEST") {
        return {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "This reset link is invalid or has expired.",
          },
        };
      }
      return genericError();
    }
  });

export type ChangePasswordResult = Envelope<{ changed: boolean }>;

/**
 * Password change (FR-08). ADR-002 §1 control 3: `revokeOtherSessions` is
 * unreliable in 1.7.28 (F5), so the compliant pairing is changePassword +
 * explicit `revokeSessions` (the authenticated API form) — the caller is
 * signed out everywhere and must re-authenticate.
 */
export const changePassword = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { currentPassword?: string; newPassword?: string })
  .handler(async ({ data }): Promise<ChangePasswordResult> => {
    await guardMutation();
    const currentPassword =
      typeof data.currentPassword === "string" ? data.currentPassword : "";
    const newPassword =
      typeof data.newPassword === "string" ? data.newPassword : "";
    const fields: Record<string, string> = {};
    if (currentPassword.length === 0) {
      fields.currentPassword = "Enter your current password.";
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      fields.newPassword = "Password must be 12–128 characters.";
    }
    if (Object.keys(fields).length > 0) {
      return validationError(fields);
    }
    const session = await readSession();
    if (!session) {
      return {
        ok: false,
        error: { code: "UNAUTHENTICATED", message: "Sign in first." },
      };
    }
    await enforceRateLimits("password-change", session.user.email);

    const auth = getAuthInstance();
    try {
      await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: false },
        headers: requestHeaders(),
        returnHeaders: true,
      });
      // F5 pairing: explicit revocation of ALL sessions (the
      // revokeOtherSessions flag is unreliable); the current session dies
      // with the rest, forcing re-authentication (C23b-compliant pattern).
      // The revocation response's headers (which clear the session cookie)
      // are what reaches the browser.
      const revokeOutcome = await auth.api.revokeSessions({
        headers: requestHeaders(),
        returnHeaders: true,
      });
      if (revokeOutcome instanceof Response) {
        for (const cookie of revokeOutcome.headers.getSetCookie()) {
          setResponseHeader("Set-Cookie", cookie);
        }
      } else {
        applyAuthSetCookies(revokeOutcome.headers);
      }
      return { ok: true, data: { changed: true } };
    } catch (error) {
      const e = error as { status?: string | number; code?: string };
      if (
        e.code === "INVALID_PASSWORD" ||
        e.code === "INVALID_EMAIL_OR_PASSWORD" ||
        e.status === "UNAUTHORIZED"
      ) {
        return validationError({
          currentPassword: "Current password is incorrect.",
        });
      }
      return genericError();
    }
  });

export type VerifyEmailResult = Envelope<{ verified: boolean }>;

/** Verification-link completion (FR-06): consumes the 24 h single token. */
export const verifyEmailToken = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { token?: string })
  .handler(async ({ data }): Promise<VerifyEmailResult> => {
    await guardMutation();
    const token = typeof data.token === "string" ? data.token.trim() : "";
    if (token === "") {
      return validationError({ token: "Missing verification token." });
    }
    const auth = getAuthInstance();
    try {
      const outcome = await auth.api.verifyEmail({
        query: { token },
        headers: requestHeaders(),
        returnHeaders: true,
      });
      // autoSignInAfterVerification issues the session cookie here.
      cookiesFromOutcome(outcome);
      return { ok: true, data: { verified: true } };
    } catch (error) {
      const e = error as { status?: string | number; code?: string };
      if (typeof e.status === "string" || typeof e.status === "number") {
        return {
          ok: false,
          error: {
            code: "VALIDATION",
            message: "This verification link is invalid or has expired.",
          },
        };
      }
      return genericError();
    }
  });

export type ResendVerificationResult = Envelope<{
  /** Identical whether or not the account exists (non-disclosure). */
  message: string;
}>;

/** Verification resend (FR-06 "resends are rate-limited"). */
export const resendVerification = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { email?: string })
  .handler(async ({ data }): Promise<ResendVerificationResult> => {
    await guardMutation();
    const email = normalizeInputEmail(data.email);
    if (!looksLikeEmail(email)) {
      return validationError({ email: "Enter a valid email address." });
    }
    await enforceRateLimits("verification-resend", email);

    const auth = getAuthInstance();
    try {
      await auth.api.sendVerificationEmail({
        body: { email, callbackURL: "/" },
        headers: requestHeaders(),
        returnHeaders: true,
      });
    } catch {
      // Swallowed: generic response regardless of existence/state.
    }
    return {
      ok: true,
      data: {
        message:
          "If an unverified account exists for that email, a new verification link has been sent.",
      },
    };
  });
