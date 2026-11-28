/**
 * SMTP mailer for verification and password-reset email (issue #24; FR-06/
 * FR-07; ADR-002 §1 control 4; ARCH-002 application↔SMTP trust boundary).
 *
 * Server-only module. SMTP is OPTIONAL in self-host: when the SMTP settings
 * are absent the mailer is disabled and Better Auth runs with verification
 * disabled — sign-up completes without verification and password recovery is
 * the operator-only reset command (FR-09; the limitation is documented in
 * src/server/auth/README.md and surfaced in the sign-up UI). Cloud requires
 * the SMTP settings at the configuration layer (runtime-config), never here.
 *
 * Only verification/reset mail is ever sent; no care data goes into email
 * (ARCH-002 trust boundaries). Message content is the actionable URL only.
 */

import nodemailer, { type Transporter } from "nodemailer";

export type SmtpSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
};

/** True when every SMTP variable is set and the port parses (FR-40 names). */
export function smtpSettingsFromEnv(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim();
  const rawPort = env.SMTP_PORT?.trim();
  const user = env.SMTP_USER;
  const password = env.SMTP_PASSWORD;
  if (!host || !rawPort || !user || !password) {
    return null;
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }
  return { host, port, user, password };
}

/**
 * True when the instance should REQUIRE email verification (FR-06): cloud
 * always has SMTP settings (runtime-config enforces them), and self-host
 * must verify when its operator configured SMTP.
 */
export function emailVerificationRequired(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): boolean {
  return smtpSettingsFromEnv(env) !== null;
}

type GlobalWithMailer = typeof globalThis & {
  /** Process-wide lazily created transport, shared by every bundled copy. */
  __toddlebook_smtp_transport__?: Transporter | null;
};

function globalTransport(): Transporter | null {
  const store = globalThis as GlobalWithMailer;
  if (store.__toddlebook_smtp_transport__ !== undefined) {
    return store.__toddlebook_smtp_transport__;
  }
  const settings = smtpSettingsFromEnv();
  if (!settings) {
    store.__toddlebook_smtp_transport__ = null;
    return null;
  }
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    auth:
      settings.user && settings.password
        ? { user: settings.user, pass: settings.password }
        : undefined,
  });
  store.__toddlebook_smtp_transport__ = transport;
  return transport;
}

const MAIL_FROM =
  process.env.SMTP_FROM?.trim() || "Toddlebook <no-reply@toddlebook.com>";

/** Sends verification mail; the URL points at the app's /verify-email page. */
export async function sendVerificationEmail(
  to: string,
  verifyUrl: string,
): Promise<void> {
  const transport = globalTransport();
  if (!transport) {
    throw new Error("smtp not configured");
  }
  await transport.sendMail({
    from: MAIL_FROM,
    to,
    subject: "Verify your Toddlebook email",
    text: `Welcome to Toddlebook. Verify your email address to finish creating your account:\n\n${verifyUrl}\n\nThe link expires after 24 hours.`,
  });
}

/** Sends the reset mail; the URL points at the app's /reset-password page. */
export async function sendResetEmail(
  to: string,
  resetUrl: string,
): Promise<void> {
  const transport = globalTransport();
  if (!transport) {
    throw new Error("smtp not configured");
  }
  await transport.sendMail({
    from: MAIL_FROM,
    to,
    subject: "Reset your Toddlebook password",
    text: `A password reset was requested for your Toddlebook account. Open this link to choose a new password:\n\n${resetUrl}\n\nThe link can be used once and expires after 60 minutes. If this was not you, no action is needed.`,
  });
}
