/**
 * Application-boundary same-origin guard for non-GET server functions
 * (issue #24; ADR-002 §1 control 1; SPEC §Security "Non-GET server functions
 * require a same-origin request").
 *
 * T1 F4 proved the library's origin/CSRF validation lives only in its HTTP
 * router, which cannot be mounted on this stack, so the control is enforced
 * HERE: every mutating server function compares the request's `Origin`
 * header (falling back to `Referer`) against the server-configured `APP_URL`
 * allowlist and REJECTS missing/invalid origins before any mutation.
 *
 * `SameSite=Lax` cookies and POST-only mutations remain in force alongside
 * this guard (they are properties of the cookie config and the server
 * function methods).
 */

import { getRequest } from "@tanstack/react-start/server";
import { appUrl } from "./instance";

/**
 * The origin allowlist for mutating requests: the configured `APP_URL`
 * origin, plus the localhost/127.0.0.1 twin of a plain-HTTP LOCAL app URL
 * (operator testing). Non-local HTTP APP_URLs allow exactly one origin.
 * Exported for tests.
 */
export function allowedOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const app = appUrl(env);
  if (!app) {
    return [];
  }
  const origins = new Set([app.origin]);
  if (app.protocol === "http:" && app.hostname === "localhost") {
    origins.add(`http://127.0.0.1:${app.port}`);
  } else if (app.protocol === "http:" && app.hostname === "127.0.0.1") {
    origins.add(`http://localhost:${app.port}`);
  }
  return [...origins];
}

/** Extracts the request origin from `Origin`, falling back to `Referer`. */
export function requestOrigin(headerMap: Headers): string | null {
  const origin = headerMap.get("origin");
  if (origin !== null && origin.trim() !== "") {
    return origin.trim();
  }
  const referer = headerMap.get("referer");
  if (referer !== null && referer.trim() !== "") {
    try {
      return new URL(referer.trim()).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * True when the request origin is allowed for mutations against `env`'s
 * APP_URL. Missing/invalid origins are rejected (never trusted). The
 * allowlist comparison is the control: browsers cannot forge `Origin`, and
 * `Host` may legitimately differ from the public origin behind proxies
 * (internal routing), so it is not cross-checked here.
 */
export function originIsAllowed(
  origin: string | null,
  _headerMap: Headers,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (origin === null) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const allowed = allowedOrigins(env);
  return allowed.includes(parsed.origin);
}

/**
 * Reads the live request headers (TanStack Start server context). Null when
 * no request context exists (pure/unit usage).
 */
export function liveRequestHeaders(): Headers | null {
  try {
    const request = getRequest();
    const headers = request?.headers;
    return headers instanceof Headers ? headers : null;
  } catch {
    return null;
  }
}
