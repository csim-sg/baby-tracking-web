/**
 * Application-boundary guards for the digital server functions and routes
 * (issue #24; ADR-002 §1 controls 1–2; FR-40/FR-43/FR-44 fail-closed; TR-12).
 *
 * These helpers are the equivalent fail-closed boundary that replaces the
 * `vite.config.ts` handler entries for the now-real HTML routes: every
 * `/app` and auth route's `beforeLoad` runs `throwUnlessSurfaceReady()` (a
 * GET server function, server-side), and every mutating server function
 * runs `guardMutation()` (readiness + same-origin + body bound) before any
 * state change. A not-ready or launch-disabled surface therefore never
 * falls through to the SSR catch-all (which would return 200 text/html —
 * the #22-proven trap): it throws a `Response` that the SSR layer sends
 * verbatim, with the same statuses and bodies the nitro gate handler
 * produced in #22 (`gateResponseFor`).
 */

import {
  getRequest,
  getRequestHeader,
  setResponseHeader,
  setResponseHeaders,
} from "@tanstack/react-start/server";
import { getDatabasePool } from "../db/pool";
import { gateResponseFor, type DigitalSurface } from "../digital-gate";
import { getDigitalReadiness } from "../readiness";
import { emailVerificationRequired } from "./mailer";
import {
  liveRequestHeaders,
  originIsAllowed,
  requestOrigin,
} from "./origin";
import {
  consumeRateLimit,
  type RateLimitedAction,
  RATE_LIMIT_POLICIES,
} from "./rate-limit";

/** TR-12: request bodies are bounded (JSON ≤ 64 KB). */
export const MAX_BODY_BYTES = 64 * 1024;

/** TR-14: security headers carried by every delivered app/auth HTML page. */
export function securityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  };
}

function jsonHeaders(): Record<string, string> {
  return { "content-type": "application/json", "cache-control": "no-store" };
}

/**
 * The fail-closed gate for a digital surface. Returns (resolving) only when
 * the surface is ready; otherwise THROWS the gate `Response` (503 when not
 * ready, 404 when launch-disabled — the identical statuses/bodies the #22
 * handler served, proven by built-server smoke). Server-side only.
 */
export async function throwUnlessSurfaceReady(
  surface: DigitalSurface,
): Promise<void> {
  const readiness = await getDigitalReadiness();
  // Ready (and not launch-disabled): the surface may serve — return.
  if (readiness.ready && !readiness.launchDisabled) {
    return;
  }
  // Not ready or launch-disabled: the exact gate response the #22 nitro
  // handler served (503 naming the failure, or the intentional 404).
  const { status, body } = gateResponseFor(surface, readiness);
  throw new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders(),
  });
}

/**
 * Same as `throwUnlessSurfaceReady`, for server functions that must also
 * carry the TR-14 security headers on the HTML document they belong to.
 */
export async function setDocumentSecurityHeaders(
  surface: DigitalSurface,
): Promise<void> {
  await throwUnlessSurfaceReady(surface);
  setResponseHeaders(
    securityHeaders() as unknown as Parameters<typeof setResponseHeaders>[0],
  );
}

/** 403 JSON envelope Response (never distinguishes more than "rejected"). */
export function forbiddenEnvelope(message: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code: "FORBIDDEN", message } }),
    { status: 403, headers: jsonHeaders() },
  );
}

/**
 * 429 JSON envelope Response for a tripped rate limit. The SPEC envelope's
 * documented codes do not enumerate 429; the AC for this issue requires 429
 * for repeated auth actions, so RATE_LIMITED→429 is the recorded extension.
 */
export function rateLimitEnvelope(
  action: RateLimitedAction,
  retryAfterSeconds: number,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: `Too many ${action.replace("-", " ")} attempts. Try again later.`,
      },
    }),
    {
      status: 429,
      headers: {
        ...jsonHeaders(),
        "retry-after": String(Math.max(1, retryAfterSeconds)),
      },
    },
  );
}

/**
 * The combined mutation guard: readiness gate → same-origin → body bound.
 * Throws the fail-closed `Response` (readiness) or a 403/422 envelope
 * Response before the handler body runs. `surface` selects the gate context
 * for the readiness evaluation (identical responses for app/auth).
 */
export async function guardMutation(
  surface: DigitalSurface = "auth",
): Promise<void> {
  await throwUnlessSurfaceReady(surface);

  const headers = liveRequestHeaders();
  const origin = headers ? requestOrigin(headers) : null;
  if (!headers || !originIsAllowed(origin, headers)) {
    throw forbiddenEnvelope("Request origin is not allowed.");
  }

  const contentLength = Number(getRequest()?.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new Response(
      JSON.stringify({
        ok: false,
        error: { code: "VALIDATION", message: "Request body too large." },
      }),
      { status: 422, headers: jsonHeaders() },
    );
  }
}

/**
 * Client IP for rate limiting. The first X-Forwarded-For entry is trusted
 * as the client address when present (deployments run behind a proxy that
 * owns this header; self-host docs must state the requirement — SPEC
 * §Security). Without the header the direct peer address is used; a
 * placeholder groups otherwise-unidentifiable clients.
 */
export function clientIpForRateLimit(): string {
  const forwarded = getRequestHeader("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const request = getRequest() as unknown as
    | { context?: { clientAddress?: string }; ip?: string }
    | undefined;
  return request?.context?.clientAddress ?? request?.ip ?? "unidentified";
}

/** Applies both per-IP and per-identifier/action limits for one action. */
export async function enforceRateLimits(
  action: RateLimitedAction,
  identifier: string,
): Promise<void> {
  const policy = RATE_LIMIT_POLICIES[action];
  const pool = getDatabasePool();
  const ip = clientIpForRateLimit();
  const perIp = await consumeRateLimit(
    pool,
    `${action}:ip`,
    ip,
    policy.ip.limit,
    policy.ip.windowSeconds,
  );
  if (!perIp.allowed) {
    throw rateLimitEnvelope(action, perIp.retryAfterSeconds);
  }
  const perIdentifier = await consumeRateLimit(
    pool,
    `${action}:id`,
    identifier,
    policy.identifier.limit,
    policy.identifier.windowSeconds,
  );
  if (!perIdentifier.allowed) {
    throw rateLimitEnvelope(action, perIdentifier.retryAfterSeconds);
  }
}

/**
 * True when the current mode requires verified email before `/app` data
 * access (FR-06): SMTP settings present (cloud always; self-host when the
 * operator configured SMTP).
 */
export function emailVerificationCurrentlyRequired(): boolean {
  return emailVerificationRequired();
}

/**
 * Deletes every session row for a user (FR-07/FR-08; SPEC §Data Model,
 * auth-owned tables: "Session rows must be revocable by user ID"). The
 * library's `revokeSessions` covers session-authenticated paths (password
 * change pairing, F5); reset success has no session in context, so the
 * SPEC-sanctioned user-ID-keyed revocation is done here. Returns the number
 * of rows removed.
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const pool = getDatabasePool();
  const result = await pool.query('DELETE FROM "session" WHERE "userId" = $1', [
    userId,
  ]);
  return result.rowCount ?? 0;
}

/**
 * Applies Better Auth's Set-Cookie values (from `returnHeaders: true`
 * responses) to the live SSR/RPC response. Spike-proven propagation path
 * (F1/C11/C16).
 */
export function applyAuthSetCookies(headers: Headers): void {
  for (const cookie of headers.getSetCookie()) {
    setResponseHeader("Set-Cookie", cookie);
  }
}
