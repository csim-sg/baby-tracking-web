/**
 * Fail-closed gate for the digital surface (FR-40, FR-43, FR-44; TR-09;
 * SPEC-002 route table note).
 *
 * While digital readiness is false, `/app`, auth, billing and webhook routes
 * return 503 naming the configuration/readiness reason. When
 * `CLOUD_APP_ENABLED=false` they return 404 as the intentional launch state,
 * and self-host never serves Stripe billing/webhook at all (ADR-002 §5).
 *
 * These JSON responses are what stand between the SSR catch-all (which would
 * otherwise answer 200 text/html with the `/` document, GTM included) and
 * the digital paths.
 */

import type { DigitalReadiness } from "./readiness";
import { getDigitalReadiness } from "./readiness";

export type DigitalSurface = "app" | "auth" | "webhook";

export type GateResponse = {
  status: number;
  body: Record<string, unknown>;
};

export function gateResponseFor(
  surface: DigitalSurface,
  readiness: DigitalReadiness,
): GateResponse {
  // Launch-disabled cloud: intentional 404 for the whole digital surface
  // (FR-44). Self-host ignores CLOUD_APP_ENABLED, so launchDisabled is never
  // true there.
  if (readiness.launchDisabled) {
    return {
      status: 404,
      body: {
        error: "not_found",
        detail: "digital surface launch-disabled (CLOUD_APP_ENABLED=false)",
      },
    };
  }

  // Billing/webhook: never served in self-host (Stripe is cloud-only,
  // ADR-002 §5) and never served without a known cloud mode.
  if (
    surface === "webhook" &&
    (readiness.mode === "selfhost" || readiness.mode === null)
  ) {
    return {
      status: 404,
      body: {
        error: "not_found",
        detail: "billing is not served in this mode",
      },
    };
  }

  // Everything else fails closed with 503 naming the reason (FR-40).
  const detail =
    readiness.problems.length > 0
      ? readiness.problems
          .map((problem) => `${problem.variable}: ${problem.detail}`)
          .join("; ")
      : "digital dependencies are not ready";
  return {
    status: 503,
    body: {
      error: "digital_unavailable",
      detail,
      checks: readiness.checks,
    },
  };
}

export async function digitalGateResponse(
  surface: DigitalSurface,
): Promise<GateResponse> {
  return gateResponseFor(surface, await getDigitalReadiness());
}
