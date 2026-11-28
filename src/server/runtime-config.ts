/**
 * Runtime mode configuration for SPEC-002 (FR-40; ADR-002 §4).
 *
 * Server-only by contract: this module is imported exclusively by server-side
 * code (nitro route handlers, TanStack Start server functions). It must never
 * be imported into the `/` client render path, and environment values must
 * never leave the server — callers expose derived booleans only.
 *
 * Parsing never throws and never exits the process (FR-40: only a failure to
 * bind the HTTP listener may exit the app non-zero). A missing or unknown
 * `DEPLOYMENT_MODE` is digital-disabled, never silently treated as cloud or
 * self-host.
 */

export type DeploymentMode = "cloud" | "selfhost";

/**
 * A configuration problem naming the offending variable. Variable values are
 * deliberately never included — responses built from these problems must not
 * leak configuration.
 */
export type ConfigProblem = {
  variable: string;
  detail: string;
};

export type RuntimeConfig = {
  /** Parsed `DEPLOYMENT_MODE`; `known: false` for a missing/unknown value. */
  mode:
    | { known: true; value: DeploymentMode }
    | { known: false; value: string | null };
  /** True when the mode is known and every required variable parses. */
  configValid: boolean;
  /**
   * Digital surface enabled: self-host always (once the mode is known);
   * cloud only when `CLOUD_APP_ENABLED` parses to true (FR-44, default
   * false — the safe cloud default until launch gates pass).
   */
  digitalEnabled: boolean;
  /** Cloud with `CLOUD_APP_ENABLED` absent or explicitly false (FR-44). */
  launchDisabled: boolean;
  problems: ConfigProblem[];
};

const LAUNCH_FLAG_VALUES = new Set(["true", "false"]);

function parseLaunchFlag(
  raw: string | undefined,
): { ok: true; value: boolean } | { ok: false } {
  if (raw === undefined) {
    return { ok: true, value: false };
  }
  const normalized = raw.trim().toLowerCase();
  if (!LAUNCH_FLAG_VALUES.has(normalized)) {
    return { ok: false };
  }
  return { ok: true, value: normalized === "true" };
}

function parseAppUrl(
  raw: string | undefined,
  requireHttps: boolean,
): ConfigProblem | null {
  if (raw === undefined || raw.trim() === "") {
    return { variable: "APP_URL", detail: "not set" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { variable: "APP_URL", detail: "not a valid URL" };
  }
  if (requireHttps && url.protocol !== "https:") {
    return { variable: "APP_URL", detail: "must use https in cloud mode" };
  }
  return null;
}

function requireSet(
  variable: string,
  raw: string | undefined,
): ConfigProblem | null {
  return raw === undefined || raw.trim() === ""
    ? { variable, detail: "not set" }
    : null;
}

/**
 * Variables required for cloud digital readiness (FR-40). SMTP settings are
 * the SES SMTP credentials; the exact variable names are provisional until
 * the auth/email wiring slice (#24) and cloud deployment slice (#38) fix
 * the operator-facing configuration set. Only variable NAMES appear in
 * problems — never values.
 */
const CLOUD_REQUIRED_VARIABLES = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
] as const;

/** Variables required for self-host digital readiness (FR-40). */
const SELFHOST_REQUIRED_VARIABLES = ["DATABASE_URL", "AUTH_SECRET"] as const;

export function parseRuntimeConfig(
  env: Record<string, string | undefined>,
): RuntimeConfig {
  const rawMode = env.DEPLOYMENT_MODE?.trim().toLowerCase();

  if (rawMode !== "cloud" && rawMode !== "selfhost") {
    // FR-40: unknown/missing mode is digital-disabled, never cloud or
    // self-host; the app must still start and serve `/` (FR-01/FR-02).
    return {
      mode: { known: false, value: env.DEPLOYMENT_MODE ?? null },
      configValid: false,
      digitalEnabled: false,
      launchDisabled: false,
      problems: [
        {
          variable: "DEPLOYMENT_MODE",
          detail:
            rawMode === undefined || rawMode === ""
              ? "not set; the digital surface is disabled"
              : 'unknown value; must be "cloud" or "selfhost"; the digital surface is disabled',
        },
      ],
    };
  }

  const problems: ConfigProblem[] = [];

  if (rawMode === "selfhost") {
    // Self-host: SMTP and Stripe are optional or absent; CLOUD_APP_ENABLED is
    // ignored entirely (FR-44).
    for (const variable of SELFHOST_REQUIRED_VARIABLES) {
      const problem = requireSet(variable, env[variable]);
      if (problem) {
        problems.push(problem);
      }
    }
    const appUrlProblem = parseAppUrl(env.APP_URL, false);
    if (appUrlProblem) {
      problems.push(appUrlProblem);
    }
    return {
      mode: { known: true, value: "selfhost" },
      configValid: problems.length === 0,
      digitalEnabled: true,
      launchDisabled: false,
      problems,
    };
  }

  // Cloud: CLOUD_APP_ENABLED is the whole-surface launch/containment control
  // (default false). Required-variable problems are only evaluated for the
  // enabled surface; a launch-disabled cloud is config-valid on its own
  // (matrix row "Cloud, config valid, CLOUD_APP_ENABLED=false": /readyz 200).
  const flag = parseLaunchFlag(env.CLOUD_APP_ENABLED);
  const launchDisabled = flag.ok && !flag.value;
  if (!flag.ok) {
    problems.push({
      variable: "CLOUD_APP_ENABLED",
      detail:
        'must be "true" or "false"; the digital surface stays disabled until it parses',
    });
  }
  if (flag.ok && !launchDisabled) {
    for (const variable of CLOUD_REQUIRED_VARIABLES) {
      const problem = requireSet(variable, env[variable]);
      if (problem) {
        problems.push(problem);
      }
    }
    const smtpPort = env.SMTP_PORT;
    if (
      smtpPort !== undefined &&
      smtpPort.trim() !== "" &&
      !/^\d+$/.test(smtpPort.trim())
    ) {
      problems.push({
        variable: "SMTP_PORT",
        detail: "must be a numeric port",
      });
    }
    const appUrlProblem = parseAppUrl(env.APP_URL, true);
    if (appUrlProblem) {
      problems.push(appUrlProblem);
    }
  }

  return {
    mode: { known: true, value: "cloud" },
    configValid: problems.length === 0,
    digitalEnabled: flag.ok && flag.value,
    launchDisabled,
    problems,
  };
}

/**
 * Reads the live process environment. Server-side only.
 */
export function readRuntimeConfig(): RuntimeConfig {
  return parseRuntimeConfig(process.env as Record<string, string | undefined>);
}
