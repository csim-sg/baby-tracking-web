import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { auth, BASE_URL } from "./auth";

/**
 * Server functions are the supported TanStack Start 1.169.7 server surface.
 * Better Auth is invoked through its programmatic API (auth.api.*) with the
 * incoming request headers; Set-Cookie values from Better Auth are applied to
 * the SSR response via TanStack Start's setResponseHeader.
 *
 * NOTE (spike scope): auth actions are exposed over GET SSR routes for
 * deterministic curl-based evidence capture. This is a test harness, not
 * production code, and is isolated under scripts/spikes/auth-compat/.
 */

export type AuthOutcome = {
  ok: boolean;
  status?: number;
  statusName?: string;
  code?: string;
  message?: string;
  setCookies: string[];
  data?: unknown;
};

async function callAuthApi<T>(
  label: string,
  invoke: () => Promise<T>,
): Promise<AuthOutcome> {
  try {
    const result = await invoke();
    const outcome: AuthOutcome = { ok: true, setCookies: [], data: undefined };
    // Rate-limit (and other middleware) responses arrive as a raw Response
    // from the better-call router; record status + cookies from it.
    if (result instanceof Response) {
      return {
        ok: result.ok,
        status: result.status,
        setCookies: result.headers.getSetCookie(),
        data: undefined,
      };
    }
    // Better Auth's returnHeaders: true wraps the response as { headers, response? }
    // or returns the payload with a headers property. Record the actual shape.
    if (
      result &&
      typeof result === "object" &&
      "headers" in result &&
      (result as { headers: unknown }).headers instanceof Headers
    ) {
      const headers = (result as { headers: Headers }).headers;
      outcome.setCookies = headers.getSetCookie();
      const response = (result as { response?: unknown }).response;
      outcome.data = response !== undefined ? response : result;
    } else {
      outcome.data = result;
    }
    return outcome;
  } catch (error) {
    // better-auth APIError carries a string status enum (e.g. "FORBIDDEN",
    // "UNAUTHORIZED"), not an HTTP status number. Record it verbatim.
    const e = error as { status?: number | string; code?: string; message?: string };
    return {
      ok: false,
      status: typeof e.status === "number" ? e.status : undefined,
      statusName: typeof e.status === "string" ? e.status : undefined,
      code: typeof e.code === "string" ? e.code : e.name,
      message: e.message,
      setCookies: [],
    };
  }
}

function applySetCookies(outcome: AuthOutcome): AuthOutcome {
  for (const cookie of outcome.setCookies) {
    setResponseHeader("Set-Cookie", cookie);
  }
  return outcome;
}

function requestHeaders(extra?: Record<string, string>): Headers {
  const request = getRequest();
  const headers = new Headers(request?.headers ?? {});
  for (const [k, v] of Object.entries(extra ?? {})) {
    headers.set(k, v);
  }
  return headers;
}

export const getSessionInfo = createServerFn({ method: "GET" }).handler(
  async () => {
    const headers = requestHeaders();
    try {
      const session = await auth.api.getSession({ headers });
      if (!session?.user) {
        return { authenticated: false as const, user: null, session: null };
      }
      return {
        authenticated: true as const,
        user: {
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
        },
        session: {
          id: session.session.id,
          expiresAt: session.session.expiresAt,
          // token is recorded only inside this test harness for evidence
          token: session.session.token,
          ipAddress: session.session.ipAddress ?? null,
          userAgent: session.session.userAgent ?? null,
        },
      };
    } catch (error) {
      const e = error as { message?: string };
      return { authenticated: false as const, error: e.message };
    }
  },
);

export type AuthAction =
  | "signUp"
  | "signIn"
  | "signOut"
  | "revokeSessions"
  | "verifyEmail"
  | "forgetPassword"
  | "resetPassword"
  | "changePassword"
  | "originCheck"
  | "rateLimitProbe";

export type AuthActionInput = {
  action: AuthAction;
  email?: string;
  password?: string;
  name?: string;
  token?: string;
  currentPassword?: string;
  newPassword?: string;
  revokeOtherSessions?: boolean;
  origin?: string;
  probeCount?: number;
  probeIp?: string;
};

export const runAuthAction = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as AuthActionInput)
  .handler(async ({ data }): Promise<AuthOutcome> => {
    // Email is passed through RAW so better-auth's own normalization behavior
    // is observable (C04 records it); FR-05 normalization is an app-level
    // concern either way.
    const email = data.email ?? "";
    switch (data.action) {
      case "signUp": {
        return applySetCookies(
          await callAuthApi("signUpEmail", () =>
            auth.api.signUpEmail({
              body: {
                email,
                password: data.password ?? "",
                name: data.name ?? "Spike User",
              },
              headers: requestHeaders(),
              returnHeaders: true,
            }),
          ),
        );
      }
      case "signIn": {
        return applySetCookies(
          await callAuthApi("signInEmail", () =>
            auth.api.signInEmail({
              body: { email, password: data.password ?? "" },
              headers: requestHeaders(),
              returnHeaders: true,
            }),
          ),
        );
      }
      case "signOut": {
        return applySetCookies(
          await callAuthApi("signOut", () =>
            auth.api.signOut({
              body: {},
              headers: requestHeaders(),
              returnHeaders: true,
            }),
          ),
        );
      }
      case "revokeSessions": {
        // better-auth 1.7.28 sign-out-all: the revokeSessions endpoint
        // ("Revoke all sessions for the user"); the legacy signOut { all: true }
        // body no longer exists. Also demonstrates the FR-08/FR-07 compliant
        // pairing pattern via the /revoke-all and /signout-all routes.
        return applySetCookies(
          await callAuthApi("revokeSessions", () =>
            auth.api.revokeSessions({
              headers: requestHeaders(),
              returnHeaders: true,
            }),
          ),
        );
      }
      case "verifyEmail": {
        return applySetCookies(
          await callAuthApi("verifyEmail", () =>
            auth.api.verifyEmail({
              query: { token: data.token ?? "" },
              headers: requestHeaders(),
              returnHeaders: true,
            }),
          ),
        );
      }
      case "forgetPassword": {
        // better-auth 1.7.28 renamed forgetPassword -> requestPasswordReset.
        return applySetCookies(
          await callAuthApi("requestPasswordReset", () =>
            auth.api.requestPasswordReset({
              body: { email },
              headers: requestHeaders(),
              returnHeaders: true,
            }),
          ),
        );
      }
      case "resetPassword": {
        return applySetCookies(
          await callAuthApi("resetPassword", () =>
            auth.api.resetPassword({
              body: {
                newPassword: data.newPassword ?? "",
                token: data.token ?? "",
              },
              headers: requestHeaders(),
              returnHeaders: true,
            }),
          ),
        );
      }
      case "changePassword": {
        return applySetCookies(
          await callAuthApi("changePassword", () =>
            auth.api.changePassword({
              body: {
                currentPassword: data.currentPassword ?? "",
                newPassword: data.newPassword ?? "",
                revokeOtherSessions: data.revokeOtherSessions ?? false,
              },
              headers: requestHeaders(),
              returnHeaders: true,
            }),
          ),
        );
      }
      case "originCheck": {
        // CSRF/origin gate: validateOrigin only engages when the request
        // carries a cookie header (or forceValidate). Probe both variants:
        // forged Origin WITH cookie (gate engaged) and WITHOUT (gate skipped).
        const forgedOrigin = data.origin ?? "https://evil.example";
        const withCookie = await callAuthApi("signInEmail(originCheck+cookie)", () =>
          auth.api.signInEmail({
            body: { email: "origin-check@example.com", password: "not-the-password-123" },
            headers: requestHeaders({
              origin: forgedOrigin,
              cookie: "better-auth.session_token=origin-probe",
            }),
            returnHeaders: true,
          }),
        );
        const withoutCookie = await callAuthApi("signInEmail(originCheck-nocookie)", () =>
          auth.api.signInEmail({
            body: { email: "origin-check@example.com", password: "not-the-password-123" },
            headers: requestHeaders({ origin: forgedOrigin }),
            returnHeaders: true,
          }),
        );
        return {
          ok: true,
          setCookies: [],
          data: { forgedOrigin, withCookie, withoutCookie },
        };
      }
      case "rateLimitProbe": {
        // Rapid failed sign-ins from one simulated source IP; record statuses.
        const n = Math.min(Math.max(data.probeCount ?? 25, 1), 50);
        const ip = data.probeIp ?? "203.0.113.7";
        const statuses: Array<number | string> = [];
        for (let i = 0; i < n; i++) {
          const outcome = await callAuthApi("signInEmail(rateLimit)", () =>
            auth.api.signInEmail({
              body: { email: `ratelimit-${ip}@example.com`, password: "definitely-wrong-123" },
              headers: requestHeaders({ "x-forwarded-for": ip }),
              returnHeaders: true,
            }),
          );
          statuses.push(outcome.status ?? outcome.statusName ?? (outcome.ok ? "ok" : "error"));
        }
        return { ok: true, setCookies: [], data: { statuses } };
      }
      default:
        return { ok: false, setCookies: [], message: `unknown action` };
    }
  });

export const appBaseUrl = BASE_URL;
