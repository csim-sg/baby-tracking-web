// Integration tests for the identity lifecycle and the child-profile
// service (issue #24; AC-02/AC-03/AC-04; FR-05–FR-08, FR-12, FR-22, FR-36).
// Skipped unless TEST_DATABASE_URL points at a disposable PostgreSQL 16
// with the migrated schema; the builder evidence runs them against the real
// database (Better Auth instance + services + direct SQL — two accounts).
//
// The F5/F6 compliant pairings are exercised at the library level here
// (changePassword + explicit revokeSessions; reset + user-ID revocation);
// the HTTP/browser-level flows — including SMTP delivery over Mailpit — are
// covered by scripts/e2e/auth-lifecycle.mjs against the built server.
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

// The runtime instance reads configuration at first use; pin a deterministic
// self-host-no-SMTP shape (verification disabled, secure cookies off) BEFORE
// importing modules that capture it.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.AUTH_SECRET = "integration-test-secret-not-a-real-secret-0123456789";
process.env.APP_URL = "http://127.0.0.1:4173";
delete process.env.SMTP_HOST;
delete process.env.SMTP_PORT;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASSWORD;
delete process.env.DEPLOYMENT_MODE;

const PASSWORD_A = "correct-horse-battery-1";
const PASSWORD_B = "staple-harmonic-glass-2";

let pool: Pool;

describeDb("auth lifecycle + child profiles (#24)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  afterAll(async () => {
    // Release the shared pg pool the auth instance lazily created.
    const { getDatabasePool } = await import("../../src/server/db/pool");
    await pool.end();
    await getDatabasePool().end().catch(() => {});
  });

  it("sign-up (no-SMTP self-host shape) creates the user and issues a DB session; sessions live in PostgreSQL", async () => {
    const { getAuthInstance } = await import(
      "../../src/server/auth/instance"
    );
    const auth = getAuthInstance();
    const email = `owner-${randomUUID()}@test.example`;
    const outcome = await auth.api.signUpEmail({
      body: { email, password: PASSWORD_A, name: "" },
      returnHeaders: true,
    });
    const setCookies = outcome.headers.getSetCookie();
    expect(setCookies.join("\n")).toContain("session_token=");
    for (const cookie of setCookies) {
      expect(cookie.toLowerCase()).toContain("httponly");
      expect(cookie.toLowerCase()).toContain("samesite=lax");
      expect(cookie.toLowerCase()).toContain("path=/");
      expect(cookie.toLowerCase()).not.toContain("secure");
    }
    const rows = await pool.query(
      'SELECT "user".id, "user".email FROM "user" WHERE "user".email = $1',
      [email],
    );
    expect(rows.rowCount).toBe(1);
    const sessions = await pool.query(
      'SELECT "id", "expiresAt" FROM "session" WHERE "userId" = $1',
      [rows.rows[0].id],
    );
    expect(sessions.rowCount).toBe(1);
    const days =
      (new Date(String(sessions.rows[0].expiresAt)).getTime() - Date.now()) /
      86_400_000;
    expect(days).toBeGreaterThan(28.5);
    expect(days).toBeLessThan(30.5);
  });

  it("password bounds are enforced (12–128) and sign-in errors are generic", async () => {
    const { getAuthInstance } = await import(
      "../../src/server/auth/instance"
    );
    const auth = getAuthInstance();
    const email = `bounds-${randomUUID()}@test.example`;
    await expect(
      auth.api.signUpEmail({
        body: { email, password: "short-11ch", name: "" },
      }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    await expect(
      auth.api.signUpEmail({
        body: { email, password: "x".repeat(129), name: "" },
      }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });

    await auth.api.signUpEmail({
      body: { email, password: PASSWORD_A, name: "" },
    });
    const wrong = await auth.api
      .signInEmail({ body: { email, password: "definitely-wrong-pass" } })
      .catch((error: { status?: string }) => error);
    expect((wrong as unknown as { status?: string }).status).toBe(
      "UNAUTHORIZED",
    );
    // And an unknown email produces the SAME error status (non-disclosure).
    const unknown = await auth.api
      .signInEmail({
        body: { email: `ghost-${randomUUID()}@test.example`, password: PASSWORD_A },
      })
      .catch((error: { status?: string }) => error);
    expect((unknown as unknown as { status?: string }).status).toBe(
      "UNAUTHORIZED",
    );
  });

  it("duplicate email is rejected by the library (the server function maps it to the generic response)", async () => {
    const { getAuthInstance } = await import(
      "../../src/server/auth/instance"
    );
    const auth = getAuthInstance();
    const email = `dupe-${randomUUID()}@test.example`;
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD_A, name: "" },
    });
    const dupe = await auth.api
      .signUpEmail({ body: { email, password: PASSWORD_B, name: "" } })
      .catch(
        (error: { body?: { code?: string }; status?: string }) => error,
      );
    // The library error NAMES the existence — the app-level sign-up function
    // maps it to the generic response and never surfaces this message.
    expect(
      (dupe as unknown as { body?: { code?: string } }).body?.code,
    ).toContain("USER_ALREADY_EXISTS");
    expect((dupe as unknown as { status?: string }).status).toBe(
      "UNPROCESSABLE_ENTITY",
    );
  });

  it("F5 pairing: changePassword (revokeOtherSessions unreliable) + explicit revokeSessions leaves ZERO session rows", async () => {
    const { getAuthInstance } = await import(
      "../../src/server/auth/instance"
    );
    const auth = getAuthInstance();
    const email = `change-${randomUUID()}@test.example`;
    const signUp = await auth.api.signUpEmail({
      body: { email, password: PASSWORD_A, name: "" },
      returnHeaders: true,
    });
    const cookieHeaders = new Headers({
      cookie: signUp.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0] ?? "")
        .join("; "),
    });
    // A SECOND session for the same account (another device).
    const second = await auth.api.signInEmail({
      body: { email, password: PASSWORD_A },
      returnHeaders: true,
    });
    expect(second.headers.getSetCookie().length).toBeGreaterThan(0);

    const withSecond = new Headers({
      cookie: second.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0] ?? "")
        .join("; "),
    });

    // The app's own changePassword flow: the flag alone is not trusted
    // (F5/C23: revokeOtherSessions does not reliably revoke other sessions
    // in 1.7.28) — the compliant pairing is changePassword followed by an
    // EXPLICIT revokeSessions (ADR-002 §1 control 3), which signs the caller
    // out everywhere.
    await auth.api.changePassword({
      body: {
        currentPassword: PASSWORD_A,
        newPassword: PASSWORD_B,
        revokeOtherSessions: false,
      },
      headers: cookieHeaders,
    });
    const afterChange = await pool.query(
      "SELECT count(*)::int AS n FROM \"session\" WHERE \"userId\" = (SELECT id FROM \"user\" WHERE email = $1)",
      [email],
    );
    // Without the explicit pairing, sessions still exist — which is exactly
    // why FR-08 requires the pairing.
    expect(afterChange.rows[0].n).toBeGreaterThan(0);

    await auth.api.revokeSessions({ headers: withSecond });
    const afterRevoke = await pool.query(
      "SELECT count(*)::int AS n FROM \"session\" WHERE \"userId\" = (SELECT id FROM \"user\" WHERE email = $1)",
      [email],
    );
    expect(afterRevoke.rows[0].n).toBe(0);
    // Old password no longer works; new password does.
    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD_A } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    const reSignIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD_B },
    });
    expect(reSignIn.user.email).toBe(email);
  });

  it("F6 pairing: reset + SPEC-sanctioned user-ID revocation kills every session and the token is single-use", async () => {
    const { getAuthInstance } = await import(
      "../../src/server/auth/instance"
    );
    const { revokeAllSessionsForUser } = await import(
      "../../src/server/auth/guard"
    );
    const auth = getAuthInstance();
    const email = `reset-${randomUUID()}@test.example`;
    const signUp = await auth.api.signUpEmail({
      body: { email, password: PASSWORD_A, name: "" },
      returnHeaders: true,
    });
    const headers = new Headers({
      cookie: signUp.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0] ?? "")
        .join("; "),
    });
    const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email]))
      .rows[0].id as string;
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM \"session\" WHERE \"userId\" = $1", [userId])).rows[0].n,
    ).toBe(1);

    // Mimic the library-written reset verification row EXACTLY: Better Auth
    // stores `identifier = "reset-password:<token>"`, `value = <userId>`
    // (password.mjs); a real SMTP-driven token is proven E2E over Mailpit.
    const token = randomUUID().replace(/-/g, "");
    await pool.query(
      'INSERT INTO "verification" ("id", "identifier", "value", "expiresAt", "updatedAt") VALUES ($1, $2, $3, now() + interval \'60 minutes\', now())',
      [randomUUID(), `reset-password:${token}`, userId],
    );

    // The resetPassword completion through the library with the reset token.
    await auth.api.resetPassword({
      body: { newPassword: PASSWORD_B, token },
    });
    // Old session must be revoked by the pairing (this is what the app's
    // reset function does after resetPassword succeeds).
    const revoked = await revokeAllSessionsForUser(userId);
    expect(revoked).toBe(1);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM \"session\" WHERE \"userId\" = $1", [userId])).rows[0].n,
    ).toBe(0);
    // Token is single-use: replay is rejected.
    await expect(
      auth.api.resetPassword({ body: { newPassword: PASSWORD_A, token } }),
    ).rejects.toBeTruthy();
    // New password works, old one dead.
    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD_A } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    const reSignIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD_B },
    });
    expect(reSignIn.user.email).toBe(email);
  });

  it("revokeAllSessionsForUser revokes by user ID (SPEC §Data Model requirement)", async () => {
    const { getAuthInstance } = await import(
      "../../src/server/auth/instance"
    );
    const { revokeAllSessionsForUser } = await import(
      "../../src/server/auth/guard"
    );
    const auth = getAuthInstance();
    const email = `revoke-all-${randomUUID()}@test.example`;
    await auth.api.signUpEmail({ body: { email, password: PASSWORD_A, name: "" } });
    await auth.api.signInEmail({ body: { email, password: PASSWORD_A } });
    const userId = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0].id as string;
    const removed = await revokeAllSessionsForUser(userId);
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM \"session\" WHERE \"userId\" = $1", [userId])).rows[0].n,
    ).toBe(0);
  });

  it("the mutation guard fails closed without a request context (origin guard)", async () => {
    // Give the readiness gate a valid self-host configuration AND the
    // server-start check registrations (the handlers import these for their
    // side effect in the real process) so the ORIGIN layer of the guard is
    // what is exercised, not the readiness layer.
    process.env.DEPLOYMENT_MODE = "selfhost";
    await import("../../src/server/auth/register-checks");
    await import("../../src/server/db/register-database-check");
    const { guardMutation } = await import("../../src/server/auth/guard");
    let thrown: unknown = null;
    try {
      await guardMutation("app");
    } catch (error) {
      thrown = error;
    }
    // No request context → no Origin → rejected before any mutation.
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });

  // -- child profiles ---------------------------------------------------- //

  it("child profiles: create/list/update with nickname bounds and the cap at 10; foreign ids are 404; delete cascades", async () => {
    const { getAuthInstance } = await import(
      "../../src/server/auth/instance"
    );
    const {
      createChild,
      listChildren,
      updateChild,
      deleteChild,
      MAX_CHILDREN,
    } = await import("../../src/server/care/children");
    const auth = getAuthInstance();

    // Two owners.
    const emailA = `kids-a-${randomUUID()}@test.example`;
    const emailB = `kids-b-${randomUUID()}@test.example`;
    const userA = (
      await auth.api.signUpEmail({ body: { email: emailA, password: PASSWORD_A, name: "" } })
    ).user;
    const userB = (
      await auth.api.signUpEmail({ body: { email: emailB, password: PASSWORD_A, name: "" } })
    ).user;

    // Nickname validation: trim, 1–40.
    const created = await createChild(userA.id, "  Mia  ");
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.data.nickname).toBe("Mia");
    }
    expect((await createChild(userA.id, "")).ok).toBe(false);
    expect((await createChild(userA.id, " ".repeat(1))).ok).toBe(false);
    const tooLong = await createChild(userA.id, "x".repeat(41));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.error.code).toBe("VALIDATION");
    }

    // Owner scoping: B cannot see, update, or delete A's profile.
    const miaId = (await listChildren(userA.id))[0]?.id as string;
    expect(await listChildren(userB.id)).toEqual([]);
    const foreignUpdate = await updateChild(userB.id, miaId, "Evil");
    expect(foreignUpdate.ok).toBe(false);
    if (!foreignUpdate.ok) {
      expect(foreignUpdate.error.code).toBe("NOT_FOUND");
    }
    const foreignDelete = await deleteChild(userB.id, miaId);
    expect(foreignDelete.ok).toBe(false);
    if (!foreignDelete.ok) {
      expect(foreignDelete.error.code).toBe("NOT_FOUND");
    }
    // Unknown id is the same NOT_FOUND.
    const unknownUpdate = await updateChild(
      userA.id,
      "00000000-0000-0000-0000-000000000000",
      "Nope",
    );
    expect(unknownUpdate.ok).toBe(false);

    // A can update their own.
    const renamed = await updateChild(userA.id, miaId, "Mia Two");
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.data.nickname).toBe("Mia Two");
    }

    // Fill to the cap; the 11th create is a LIMIT error.
    for (let count = 2; count <= MAX_CHILDREN; count += 1) {
      const result = await createChild(userA.id, `Child ${count}`);
      expect(result.ok, `create #${count}`).toBe(true);
    }
    const eleventh = await createChild(userA.id, "One Too Many");
    expect(eleventh.ok).toBe(false);
    if (!eleventh.ok) {
      expect(eleventh.error.code).toBe("LIMIT");
    }
    expect((await listChildren(userA.id)).length).toBe(MAX_CHILDREN);

    // Concurrency: two simultaneous creates against a 10/10 account — at
    // most one may win (advisory-locked cap check).
    // (Free one slot first.)
    const firstChild = (await listChildren(userA.id))[0]?.id as string;
    expect((await deleteChild(userA.id, firstChild)).ok).toBe(true);
    const [raceA, raceB] = await Promise.all([
      createChild(userA.id, "Race A"),
      createChild(userA.id, "Race B"),
    ]);
    const winners = [raceA, raceB].filter((r) => r.ok).length;
    expect(winners).toBe(1);
    expect((await listChildren(userA.id)).length).toBe(MAX_CHILDREN);

    // Deletion cascades the child's logs and entries (FR-36; SQL level).
    const logChildId = (
      await createChild(userB.id, "Cascade Kid")
    );
    expect(logChildId.ok).toBe(true);
    if (logChildId.ok) {
      const kidId = logChildId.data.id;
      const logId = (
        await pool.query(
          'INSERT INTO "day_log" ("user_id", "child_id", "log_date", "config_snapshot") VALUES ($1, $2, current_date, $3) RETURNING id',
          [userB.id, kidId, JSON.stringify({ items: [{ label: "Feed" }] })],
        )
      ).rows[0].id as string;
      await pool.query(
        'INSERT INTO "care_entry" ("day_log_id", "item_index", "item_label", "occurred_time", "client_key") VALUES ($1, 0, \'Feed\', \'08:00\', $2)',
        [logId, randomUUID()],
      );
      const deleted = await deleteChild(userB.id, kidId);
      expect(deleted.ok).toBe(true);
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM "day_log" WHERE "id" = $1', [logId])).rows[0].n,
      ).toBe(0);
      expect(
        (await pool.query('SELECT count(*)::int AS n FROM "care_entry" WHERE "day_log_id" = $1', [logId])).rows[0].n,
      ).toBe(0);
    }

    // The list never contains another owner's profile.
    const listA = await listChildren(userA.id);
    expect(listA.find((child) => child.nickname === "Cascade Kid")).toBeUndefined();
  });
});
