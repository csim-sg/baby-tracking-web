/**
 * Drizzle schema for the six SPEC-002 application tables (AC-04/AC-05/
 * AC-06/AC-14; FR-14–FR-22, FR-35–FR-37; ADR-002 §6; ARCH-002 canonical
 * models and ownership).
 *
 * Two truths, one source each:
 * - The committed SQL in ./migrations/ is the schema of record — it is what
 *   `npm run migrate` applies (idempotent, transactional per file, no
 *   migration-state table). Constraint DDL that Drizzle cannot express
 *   exactly (the `ON DELETE SET NULL (template_id)` column-list form and the
 *   externally-owned `user` table) is written in that SQL.
 * - This module is the typed runtime mirror used by query code. It must stay
 *   consistent with the SQL; tests/integration/schema.test.ts introspects
 *   the live catalog and asserts the SPEC constraints, so drift fails CI-visible
 *   tests.
 *
 * Auth-owned tables (`user`, `session`, `account`, `verification`) are NOT
 * declared here — Better Auth 1.7.28 owns their DDL and migrates them with
 * its own runner before the application migrations (scripts/migrate.mjs).
 * A minimal, module-local `authUsers` declaration exists only so Drizzle can
 * type the owner foreign keys; it must never be generated or migrated by
 * Drizzle tooling.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Module-local mirror of the Better Auth-owned `user` table, limited to what
 * the owner foreign keys reference (`user.id`, text, primary key). NOT an
 * application table: its DDL is produced exclusively by the auth library's
 * migration runner, and no identity rows are written by application tables.
 */
const authUsers = pgTable("user", {
  id: text("id").primaryKey(),
});

/** Owner-only care subject (FR-12): nickname plus timestamps, nothing else. */
export const childProfiles = pgTable(
  "child_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    nickname: varchar("nickname", { length: 40 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("child_profile_id_user_id_key").on(t.id, t.userId),
    foreignKey({
      name: "child_profile_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("child_profile_user_id_created_at_idx").on(t.userId, t.createdAt),
  ],
);

/** Saved sheet configuration (FR-13/FR-14). No unique name constraint. */
export const sheetTemplates = pgTable(
  "sheet_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    config: jsonb("config").notNull(),
    configVersion: smallint("config_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("sheet_template_id_user_id_key").on(t.id, t.userId),
    foreignKey({
      name: "sheet_template_user_id_fkey",
      columns: [t.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("sheet_template_user_id_updated_at_idx").on(
      t.userId,
      t.updatedAt.desc(),
    ),
  ],
);

/**
 * One child, one calendar date (FR-16/FR-17). `configSnapshot` is the
 * immutable layout copied at creation; `templateId` is provenance only.
 */
export const dayLogs = pgTable(
  "day_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    childId: uuid("child_id").notNull(),
    logDate: date("log_date").notNull(),
    templateId: uuid("template_id"),
    configSnapshot: jsonb("config_snapshot").notNull(),
    configVersion: smallint("config_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("day_log_child_id_log_date_key").on(t.childId, t.logDate),
    unique("day_log_id_user_id_key").on(t.id, t.userId),
    foreignKey({
      name: "day_log_child_id_user_id_fkey",
      columns: [t.childId, t.userId],
      foreignColumns: [childProfiles.id, childProfiles.userId],
    }).onDelete("cascade"),
    // The committed SQL uses ON DELETE SET NULL (template_id) so only the
    // provenance column is nulled; Drizzle's onDelete("set null") is the
    // closest expressible approximation.
    foreignKey({
      name: "day_log_template_id_user_id_fkey",
      columns: [t.templateId, t.userId],
      foreignColumns: [sheetTemplates.id, sheetTemplates.userId],
    }).onDelete("set null"),
    index("day_log_user_id_log_date_id_idx").on(
      t.userId,
      t.logDate.desc(),
      t.id.desc(),
    ),
    index("day_log_user_id_child_id_log_date_id_idx").on(
      t.userId,
      t.childId,
      t.logDate.desc(),
      t.id.desc(),
    ),
  ],
);

/**
 * A care entry on a day log (FR-18/FR-19). Deliberately no user_id column:
 * the owner is reached through day_log, and the composite owner keys above
 * keep every log owner-checked.
 */
export const careEntries = pgTable(
  "care_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dayLogId: uuid("day_log_id").notNull(),
    itemIndex: smallint("item_index").notNull(),
    itemLabel: varchar("item_label", { length: 40 }).notNull(),
    occurredTime: time("occurred_time").notNull(),
    value: varchar("value", { length: 64 }),
    note: varchar("note", { length: 500 }),
    clientKey: uuid("client_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "care_entry_item_index_check",
      sql`${t.itemIndex} between 0 and 15`,
    ),
    unique("care_entry_day_log_id_client_key_key").on(t.dayLogId, t.clientKey),
    foreignKey({
      name: "care_entry_day_log_id_fkey",
      columns: [t.dayLogId],
      foreignColumns: [dayLogs.id],
    }).onDelete("cascade"),
    index("care_entry_day_log_id_occurred_time_id_idx").on(
      t.dayLogId,
      t.occurredTime,
      t.id,
    ),
  ],
);

/**
 * Stripe subscription mirror keyed by the owner (FR-31/FR-32). Cloud-only
 * data; the table exists empty in self-host so both modes share one schema.
 * Stripe is authoritative; this row is a mirror.
 */
export const subscriptions = pgTable("subscription", {
  userId: text("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  priceId: text("price_id").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end")
    .notNull()
    .default(false),
  paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Stripe webhook idempotency record (FR-30): event ID, type and outcome
 * only — no payload, customer email or card data is ever persisted.
 */
export const stripeEvents = pgTable("stripe_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  outcome: text("outcome"),
});
