/**
 * Application-boundary email normalization and URL/return-path rules
 * (issue #24; FR-05; ADR-002 §1 control 4; spike F9).
 *
 * Better Auth lowercases emails on storage but REJECTS space-padded input
 * with 400 INVALID_EMAIL (spike C04/F9), so FR-05's "trimmed" must be
 * applied here, before every auth API call.
 */

/**
 * Trims surrounding whitespace and lowercases the email. This is the ONLY
 * normalization FR-05 asks for — the local part is not otherwise rewritten.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Minimal RFC-ish shape check applied before calling the auth API. */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

/**
 * Local-path allowlist for sign-in/verification return targets (ADR-002 §1
 * control 1; SPEC "Return paths … are allowlisted to local paths"). Only a
 * relative path starting with a single slash passes — no scheme, no
 * protocol-relative `//`, no backslash tricks.
 */
export function isLocalReturnPath(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return false;
  }
  if (!raw.startsWith("/")) {
    return false;
  }
  if (raw.startsWith("//") || raw.startsWith("/\\")) {
    return false;
  }
  if (/[\r\n]/.test(raw)) {
    return false;
  }
  // Any embedded scheme (`/x?next=http://…` is a harmless query value, but a
  // value that IS a full URL must not pass) — reject anything containing
  // `://` or an absolute-looking `scheme:` prefix.
  if (raw.includes("://") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    return false;
  }
  return true;
}

/** The validated return path for a digital surface, or its default. */
export function safeReturnPath(
  raw: string | undefined,
  fallback: string,
): string {
  return raw !== undefined && isLocalReturnPath(raw) ? raw : fallback;
}
