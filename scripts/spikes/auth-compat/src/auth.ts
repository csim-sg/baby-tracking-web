import { betterAuth } from "better-auth";
import { Pool } from "pg";
import nodemailer from "nodemailer";

/**
 * Test-only Better Auth configuration for the compatibility spike.
 * Ephemeral local infrastructure only (postgres:16 + Mailpit via docker-compose.yaml).
 * Mirrors SPEC-002 FR-05/FR-06/FR-07/FR-08 where Better Auth has a matching knob:
 * - password length 12–128 (FR-05)
 * - verified email required before access (FR-06, SMTP-on mode)
 * - reset token 60 min (FR-07)
 * - DB-backed sessions, 30 days, refresh on activity (FR-08)
 */
export const DATABASE_URL =
  process.env.AUTH_DATABASE_URL ??
  "postgres://spiketest:spiketest@127.0.0.1:55432/spiketest";

export const BASE_URL =
  process.env.AUTH_BASE_URL ?? "http://127.0.0.1:3300";

const smtpHost = process.env.SMTP_HOST ?? "127.0.0.1";
const smtpPort = Number(process.env.SMTP_PORT ?? 8125);

export const transport = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: false,
});

export const pool = new Pool({ connectionString: DATABASE_URL });

export const authOptions = {
  appName: "auth-compat-spike",
  baseURL: BASE_URL,
  trustedOrigins: ["http://127.0.0.1:3300", "http://localhost:3300"],
  database: pool,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 3600,
    sendResetPassword: async ({ user, url }) => {
      await transport.sendMail({
        from: "spike@test.local",
        to: user.email,
        subject: "auth-spike: reset password",
        text: url,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await transport.sendMail({
        from: "spike@test.local",
        to: user.email,
        subject: "auth-spike: verify email",
        text: url,
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // FR-08: 30 days of inactivity
    updateAge: 1, // seconds; artificially small so "refresh on activity" is testable
  },
  rateLimit: {
    enabled: true,
    window: 10, // seconds
    max: 20, // high enough that functional checks do not trip it; rate-limit check fires 30 rapid calls
  },
};

export const auth = betterAuth(authOptions);
