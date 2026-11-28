#!/usr/bin/env node
/**
 * Operator password-reset command (issue #24; FR-09; AC-03).
 *
 * A committed operator command — NOT an HTTP surface. It requires shell and
 * database access (it runs where DATABASE_URL is available); no route,
 * handler or server function exposes it, and it is not part of the built
 * server output (scripts/ are not copied into .output). Cloud operators use
 * it only as a documented break-glass procedure; self-host operators use it
 * as THE recovery path when SMTP is absent. Image packaging is issue #37.
 *
 * Usage:
 *   npm run reset-password -- <email> <new-password>
 *   RESET_EMAIL=… RESET_PASSWORD=… npm run reset-password   (avoids argv
 *                                                            leaking the
 *                                                            password into
 *                                                            shell history)
 *
 * What it does, in one transaction:
 *   1. normalizes the email (trim + lowercase, same rule as sign-in);
 *   2. hashes the new password with the LIBRARY's own hash (no custom
 *      cryptography) via the auth context;
 *   3. updates the credential account row's password;
 *   4. deletes every session row for that user (FR-08: password changes
 *      revoke all sessions — a reset is a password change).
 *
 * Exit codes: 0 success, 1 any failure (no account found, DB error).
 * Output never echoes the connection URL, the password, or any token.
 */
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
import { basename } from "node:path";

function fail(message) {
  console.error(`reset-password: ${message}`);
  process.exit(1);
}

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const email = (process.env.RESET_EMAIL ?? positional[0] ?? "")
  .trim()
  .toLowerCase();
const password = process.env.RESET_PASSWORD ?? positional[1] ?? "";

if (!email || !password) {
  console.error(
    `usage: ${basename(process.argv[1] ?? "reset-password")} <email> <new-password>\n` +
      "       (or RESET_EMAIL=<email> RESET_PASSWORD=<password> — keeps the password out of shell history)",
  );
  process.exit(1);
}
if (password.length < 12 || password.length > 128) {
  fail("new password must be 12–128 characters");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || databaseUrl.trim() === "") {
  fail("DATABASE_URL is not set");
}

/** Masks credentials; connection URLs are never echoed whole. */
function sanitizeUrl(url) {
  return url.replace(/\/\/[^@/]*@/, "//***@");
}
console.log(`reset-password: target ${sanitizeUrl(databaseUrl)}`);

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10000,
});

try {
  // The library's own hashing (scrypt) — the exact default that
  // context.password.hash resolves to (better-auth create-context.mjs), so
  // sign-in verifies the new password with no custom cryptography.
  const hash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const user = await client.query(
      'SELECT "id" FROM "user" WHERE "email" = $1 LIMIT 1',
      [email],
    );
    const userId = user.rows[0]?.id;
    if (typeof userId !== "string") {
      await client.query("ROLLBACK");
      fail("no account matches that email (nothing changed)");
    }

    const updated = await client.query(
      'UPDATE "account" SET "password" = $1 WHERE "userId" = $2 AND "providerId" = $3',
      [hash, userId, "credential"],
    );
    if ((updated.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      fail("no email/password credential found for that account (nothing changed)");
    }

    const revoked = await client.query(
      'DELETE FROM "session" WHERE "userId" = $1',
      [userId],
    );

    await client.query("COMMIT");
    const masked = email.length > 0 ? `${email[0]}***${email.includes("@") ? email.slice(email.indexOf("@")) : ""}` : "***";
    console.log(
      `reset-password: password updated for ${masked}; ` +
        `${revoked.rowCount ?? 0} session(s) revoked`,
    );
    console.log("reset-password: OK — sign in with the new password");
  } finally {
    client.release();
  }
} catch (error) {
  fail(`reset failed: ${error.message}`);
} finally {
  await pool.end().catch(() => {});
}
