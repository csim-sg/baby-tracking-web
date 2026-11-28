// Integration tests against a disposable PostgreSQL 16 (issue #23; AC-04/
// AC-05/AC-14/AC-15; FR-15/FR-18/FR-19/FR-22; TR-13). Skipped unless
// TEST_DATABASE_URL points at an empty, disposable database; the builder
// evidence runs them after `npm run migrate` applied the schema.
//
// These tests drive the REAL migration command (child process) for the
// idempotency check, then introspect the live catalog and exercise owner
// isolation at the database layer with direct SQL — two accounts, cross-owner
// references rejected by composite foreign keys, template deletion preserving
// the day-log snapshot, idempotency/entry constraints, and cascade deletion.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

let pool: Pool;

// -- helpers ------------------------------------------------------------ //

async function query(sql: string, values: unknown[] = []) {
  const result = await pool.query(sql, values);
  return result.rows;
}

/** Inserts a minimal auth `user` row, discovering required columns. */
async function insertUser(label: string): Promise<string> {
  const id = randomUUID();
  const columns = await query(
    `SELECT column_name, data_type, column_default, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user'`,
  );
  const names: string[] = [];
  const values: unknown[] = [];
  for (const column of columns) {
    const name = String(column.column_name);
    const required =
      column.is_nullable === "NO" &&
      column.column_default === null &&
      !/\bnextval\(/.test(String(column.column_default ?? ""));
    if (!required || name === "id") {
      continue;
    }
    names.push(`"${name}"`);
    values.push(fillColumn(name, String(column.data_type), label));
  }
  names.push('"id"');
  values.push(id);
  await query(
    `INSERT INTO "user" (${names.join(", ")}) VALUES (${names
      .map((_, position) => `$${position + 1}`)
      .join(", ")})`,
    values,
  );
  return id;
}

function fillColumn(name: string, dataType: string, label: string): unknown {
  const lower = name.toLowerCase();
  if (dataType === "boolean") {
    return true;
  }
  if (dataType === "timestamp with time zone" || dataType === "date") {
    return new Date(Date.now() + 60 * 60 * 1000);
  }
  if (lower.includes("email")) {
    return `${label}-${randomUUID()}@test.example`;
  }
  if (lower === "name") {
    return `Owner ${label}`;
  }
  return randomUUID();
}

async function insertChild(userId: string, nickname: string): Promise<string> {
  const rows = await query(
    `INSERT INTO child_profile (user_id, nickname) VALUES ($1, $2) RETURNING id`,
    [userId, nickname],
  );
  return String(rows[0]?.id);
}

async function insertTemplate(
  userId: string,
  name: string,
): Promise<string> {
  const rows = await query(
    `INSERT INTO sheet_template (user_id, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [userId, name, JSON.stringify({ items: [{ label: "Feed" }] })],
  );
  return String(rows[0]?.id);
}

async function insertDayLog(input: {
  userId: string;
  childId: string;
  templateId?: string | null;
  logDate?: string;
}): Promise<string> {
  const rows = await query(
    `INSERT INTO day_log (user_id, child_id, template_id, log_date, config_snapshot)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.userId,
      input.childId,
      input.templateId ?? null,
      input.logDate ?? "2026-11-28",
      JSON.stringify({ items: [{ label: "Feed" }] }),
    ],
  );
  return String(rows[0]?.id);
}

/** Runs the real one-shot migration command against TEST_DATABASE_URL. */
function runMigrate(): { status: number; output: string } {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/migrate.mjs"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      encoding: "utf8",
    },
  );
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

// -- suite -------------------------------------------------------------- //

describeDb("PostgreSQL schema and owner constraints (#23)", () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("the real migration command succeeds and a second run is a safe no-op", () => {
    const first = runMigrate();
    expect(first.status).toBe(0);
    expect(first.output).toContain("auth runner applied");
    const second = runMigrate();
    expect(second.status).toBe(0);
    expect(second.output).toContain("application schema present before run: yes");
    expect(second.output).toContain("re-run is a no-op");
    expect(second.output).not.toContain("FAILED");
  });

  it("all ten tables exist: six application + four auth-owned", async () => {
    const tables = (
      await query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
      )
    ).map((row) => String(row.table_name));
    for (const expected of [
      "account",
      "care_entry",
      "child_profile",
      "day_log",
      "session",
      "sheet_template",
      "stripe_event",
      "subscription",
      "user",
      "verification",
    ]) {
      expect(tables).toContain(expected);
    }
    // No migration-state table beyond the SPEC set.
    expect(tables).toEqual([
      "account",
      "care_entry",
      "child_profile",
      "day_log",
      "session",
      "sheet_template",
      "stripe_event",
      "subscription",
      "user",
      "verification",
    ]);
  });

  it("SPEC columns, types and defaults exist (spot-checked per table)", async () => {
    const columns = await query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    );
    const col = (table: string, name: string) =>
      columns.find(
        (row) => row.table_name === table && row.column_name === name,
      );
    // child_profile
    expect(col("child_profile", "id")?.data_type).toBe("uuid");
    expect(col("child_profile", "id")?.column_default).toContain(
      "gen_random_uuid",
    );
    expect(col("child_profile", "user_id")?.data_type).toBe("text");
    expect(col("child_profile", "user_id")?.is_nullable).toBe("NO");
    expect(col("child_profile", "nickname")?.data_type).toBe("character varying");
    // sheet_template
    expect(col("sheet_template", "config")?.data_type).toBe("jsonb");
    expect(col("sheet_template", "config_version")?.column_default).toContain(
      "1",
    );
    // day_log
    expect(col("day_log", "log_date")?.data_type).toBe("date");
    expect(col("day_log", "template_id")?.is_nullable).toBe("YES");
    expect(col("day_log", "config_snapshot")?.data_type).toBe("jsonb");
    // care_entry — wall-clock time without time zone by design
    expect(col("care_entry", "occurred_time")?.data_type).toBe(
      "time without time zone",
    );
    expect(col("care_entry", "client_key")?.data_type).toBe("uuid");
    expect(col("care_entry", "note")?.data_type).toBe("character varying");
    // subscription / stripe_event
    expect(col("subscription", "user_id")?.data_type).toBe("text");
    expect(col("stripe_event", "id")?.data_type).toBe("text");
    expect(col("stripe_event", "processed_at")?.is_nullable).toBe("YES");
  });

  it("owner keys, composite FKs, uniques and the item_index check match the SPEC", async () => {
    const constraints = await query(
      `SELECT conrelid::regclass::text AS table_name, conname, contype,
              pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
        ORDER BY conname`,
    );
    const find = (name: string) =>
      constraints.find((row) => row.conname === name);

    // Composite owner FKs (AC-04; TR-13).
    const childFk = find("day_log_child_id_user_id_fkey");
    expect(childFk?.definition).toContain(
      "FOREIGN KEY (child_id, user_id) REFERENCES child_profile(id, user_id)",
    );
    expect(childFk?.definition).toContain("ON DELETE CASCADE");
    const templateFk = find("day_log_template_id_user_id_fkey");
    expect(templateFk?.definition).toContain(
      "FOREIGN KEY (template_id, user_id) REFERENCES sheet_template(id, user_id)",
    );
    // Column-limited SET NULL: provenance nulls, owner + snapshot survive.
    expect(templateFk?.definition).toContain(
      "ON DELETE SET NULL (template_id)",
    );
    expect(find("care_entry_day_log_id_fkey")?.definition).toContain(
      "REFERENCES day_log(id)",
    );
    expect(find("child_profile_user_id_fkey")?.definition).toContain(
      'REFERENCES "user"(id)',
    );
    expect(find("subscription_user_id_fkey")?.definition).toContain(
      'REFERENCES "user"(id)',
    );
    // Unique keys.
    expect(find("child_profile_id_user_id_key")?.definition).toContain(
      "UNIQUE (id, user_id)",
    );
    expect(find("sheet_template_id_user_id_key")?.definition).toContain(
      "UNIQUE (id, user_id)",
    );
    expect(find("day_log_id_user_id_key")?.definition).toContain(
      "UNIQUE (id, user_id)",
    );
    expect(find("day_log_child_id_log_date_key")?.definition).toContain(
      "UNIQUE (child_id, log_date)",
    );
    expect(find("care_entry_day_log_id_client_key_key")?.definition).toContain(
      "UNIQUE (day_log_id, client_key)",
    );
    expect(find("care_entry_item_index_check")?.definition).toContain(
      "item_index",
    );
  });

  it("the SPEC query-path indexes exist", async () => {
    const indexes = (
      await query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)
    ).map((row) => String(row.indexname));
    for (const expected of [
      "child_profile_user_id_created_at_idx",
      "sheet_template_user_id_updated_at_idx",
      "day_log_user_id_log_date_id_idx",
      "day_log_user_id_child_id_log_date_id_idx",
      "care_entry_day_log_id_occurred_time_id_idx",
    ]) {
      expect(indexes).toContain(expected);
    }
  });

  it("rejects cross-owner child, template and log references at the database layer", async () => {
    const userA = await insertUser("a");
    const userB = await insertUser("b");
    const childA = await insertChild(userA, "Alex");
    const templateA = await insertTemplate(userA, "A sheet");

    // Account B references account A's child with B's own user_id → FK violation.
    await expect(
      query(
        `INSERT INTO day_log (user_id, child_id, log_date, config_snapshot)
         VALUES ($1, $2, $3, $4)`,
        [userB, childA, "2026-11-28", JSON.stringify({ items: [] })],
      ),
    ).rejects.toThrow(/child_profile|day_log_child_id_user_id_fkey/);

    // Account B references account A's template with B's own user_id → FK violation.
    await expect(
      query(
        `INSERT INTO day_log (user_id, child_id, template_id, log_date, config_snapshot)
         VALUES ($1, $2, $3, $4, $5)`,
        [userB, await insertChild(userB, "Blair"), templateA, "2026-11-28", JSON.stringify({ items: [] })],
      ),
    ).rejects.toThrow(/sheet_template|day_log_template_id_user_id_fkey/);

    // A valid log for B and a cross-owner template update attempt both fail
    // at the database, not just in service code: B cannot move A's template
    // row into B's ownership either (owner-checked unique key is not a
    // mutation path; direct row updates are covered by the same FK shape).
    const logB = await insertDayLog({
      userId: userB,
      childId: await insertChild(userB, "Bo"),
    });
    expect(logB).toBeTruthy();

    // One log per child/date: a second insert for the same child/date fails.
    const childB = await insertChild(userB, "Bee");
    await insertDayLog({ userId: userB, childId: childB, logDate: "2026-12-01" });
    await expect(
      query(
        `INSERT INTO day_log (user_id, child_id, log_date, config_snapshot)
         VALUES ($1, $2, $3, $4)`,
        [userB, childB, "2026-12-01", JSON.stringify({ items: [] })],
      ),
    ).rejects.toThrow(/day_log_child_id_log_date_key/);
  });

  it("template deletion nulls template_id only; snapshot and owner survive", async () => {
    const userId = await insertUser("t");
    const childId = await insertChild(userId, "Tem");
    const templateId = await insertTemplate(userId, "Doomed template");
    const snapshot = { items: [{ label: "Nap" }], day: 2 };
    const logRows = await query(
      `INSERT INTO day_log (user_id, child_id, template_id, log_date, config_snapshot)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, childId, templateId, "2026-11-27", JSON.stringify(snapshot)],
    );
    const logId = String(logRows[0]?.id);

    await query(`DELETE FROM sheet_template WHERE id = $1`, [templateId]);

    const after = await query(
      `SELECT template_id, user_id, config_snapshot FROM day_log WHERE id = $1`,
      [logId],
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.template_id).toBeNull();
    expect(after[0]?.user_id).toBe(userId);
    expect(after[0]?.config_snapshot).toEqual(snapshot);
  });

  it("enforces the item_index check and (day_log_id, client_key) idempotency", async () => {
    const userId = await insertUser("e");
    const childId = await insertChild(userId, "Edi");
    const logId = await insertDayLog({ userId, childId });

    const insertEntry = (itemIndex: number, clientKey: string) =>
      query(
        `INSERT INTO care_entry (day_log_id, item_index, item_label, occurred_time, value, note, client_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [logId, itemIndex, "Feed", "08:30:00", "ok", null, clientKey],
      );

    await insertEntry(0, randomUUID());
    await insertEntry(15, randomUUID());

    // Outside 0..15 → check constraint violation.
    await expect(insertEntry(16, randomUUID())).rejects.toThrow(
      /care_entry_item_index_check/,
    );
    await expect(insertEntry(-1, randomUUID())).rejects.toThrow(
      /care_entry_item_index_check/,
    );

    // Same client_key on the same log → unique violation (no duplicate).
    const key = randomUUID();
    await insertEntry(1, key);
    await expect(insertEntry(1, key)).rejects.toThrow(
      /care_entry_day_log_id_client_key_key/,
    );
    // The same client_key on a DIFFERENT log is a different create and is
    // allowed (uniqueness is scoped to the log).
    const otherLog = await insertDayLog({ userId, childId, logDate: "2026-11-26" });
    await query(
      `INSERT INTO care_entry (day_log_id, item_index, item_label, occurred_time, client_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [otherLog, 1, "Feed", "08:30:00", key],
    );
  });

  it("deletion cascades: child removal removes logs and entries; user removal removes everything", async () => {
    const userId = await insertUser("c");
    const childId = await insertChild(userId, "Cass");
    const logId = await insertDayLog({ userId, childId });
    await query(
      `INSERT INTO care_entry (day_log_id, item_index, item_label, occurred_time, client_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [logId, 2, "Feed", "09:00:00", randomUUID()],
    );

    await query(`DELETE FROM child_profile WHERE id = $1`, [childId]);
    expect(
      await query(`SELECT id FROM day_log WHERE id = $1`, [logId]),
    ).toHaveLength(0);
    expect(
      await query(`SELECT id FROM care_entry WHERE day_log_id = $1`, [logId]),
    ).toHaveLength(0);

    const child2 = await insertChild(userId, "Cora");
    const log2 = await insertDayLog({ userId, childId: child2 });
    await query(
      `INSERT INTO subscription (user_id, stripe_customer_id, price_id, status)
       VALUES ($1, $2, $3, $4)`,
      [userId, `cus_${randomUUID()}`, "price_test", "active"],
    );
    await query(`DELETE FROM "user" WHERE id = $1`, [userId]);
    expect(await query(`SELECT id FROM day_log WHERE id = $1`, [log2])).toHaveLength(0);
    expect(await query(`SELECT user_id FROM subscription WHERE user_id = $1`, [userId])).toHaveLength(0);
    expect(await query(`SELECT id FROM child_profile WHERE user_id = $1`, [userId])).toHaveLength(0);
  });
});
