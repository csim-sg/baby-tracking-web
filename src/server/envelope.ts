/**
 * The SPEC-002 server-function error envelope (issue #24; SPEC §API and
 * Interface Changes → Contracts). All server functions return
 * `{ ok: true, data }` or `{ ok: false, error }`; the error codes map to
 * HTTP statuses exactly as the SPEC table defines. Guards that must deliver
 * a raw HTTP status (fail-closed 503/404, 403 origin rejection, 429 rate
 * limiting) throw the equivalent envelope as a `Response` from the
 * server-function boundary.
 */

export type EnvelopeErrorCode =
  | "UNAUTHENTICATED" // 401
  | "FORBIDDEN" // 403
  | "PAYMENT_REQUIRED" // 402
  | "NOT_FOUND" // 404 — always used for cross-owner/foreign IDs
  | "CONFLICT" // 409
  | "VALIDATION" // 422
  | "LIMIT" // 422 (e.g. the 10-child cap)
  | "RATE_LIMITED" // 429 (issue #24 AC extension, recorded)
  | "DEPENDENCY_UNAVAILABLE" // 503
  | "INTERNAL"; // 500

export type EnvelopeError = {
  code: EnvelopeErrorCode;
  message: string;
  fields?: Record<string, string>;
};

export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: EnvelopeError };

export function validationError(
  fields: Record<string, string>,
  message = "Please check the form.",
): Envelope<never> {
  return { ok: false, error: { code: "VALIDATION", message, fields } };
}

export function notFoundError(
  message = "Not found",
): Envelope<never> {
  return { ok: false, error: { code: "NOT_FOUND", message } };
}

export function limitError(
  message: string,
): Envelope<never> {
  return { ok: false, error: { code: "LIMIT", message } };
}

export function unauthenticatedError(
  message = "Sign in to continue.",
): Envelope<never> {
  return { ok: false, error: { code: "UNAUTHENTICATED", message } };
}

export function internalError(
  message = "Something went wrong. Try again.",
): Envelope<never> {
  return { ok: false, error: { code: "INTERNAL", message } };
}
