-- Initial application schema (SPEC-002 §Data Model Changes; AC-04/AC-05/AC-06/
-- AC-14/AC-15; FR-14–FR-22, FR-35–FR-37, FR-36/FR-37; ADR-002 §6; ARCH-002
-- canonical models).
--
-- Auth-owned tables (`user`, `session`, `account`, `verification`) are created
-- by the Better Auth 1.7.28 migration runner BEFORE this file (see
-- scripts/migrate.mjs ordering). This file references "user"(id) as the owner
-- key but contains no auth DDL — the library owns those tables.
--
-- Conventions:
-- - Idempotent by construction: every statement is IF NOT EXISTS and every
--   constraint lives inside its guarded CREATE TABLE, so a re-run on an
--   already-migrated database is a no-op. There is deliberately NO
--   migration-state table; the schema itself is the migration state
--   (mirrors the Better Auth runner, which re-introspects the catalog).
-- - Transactional: scripts/migrate.mjs runs this whole file in one explicit
--   transaction, so a failure leaves no partial application schema (AC-15).
-- - Forward-only: v1 has no previous schema; later changes follow the
--   expand/contract policy documented in src/server/db/README.md.
-- - gen_random_uuid() needs no extension on PostgreSQL 16.

CREATE TABLE IF NOT EXISTS "child_profile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "nickname" varchar(40) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "child_profile_id_user_id_key" UNIQUE ("id", "user_id")
);

CREATE TABLE IF NOT EXISTS "sheet_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "name" varchar(80) NOT NULL,
  "config" jsonb NOT NULL,
  "config_version" smallint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sheet_template_id_user_id_key" UNIQUE ("id", "user_id")
);

CREATE TABLE IF NOT EXISTS "day_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "child_id" uuid NOT NULL,
  "log_date" date NOT NULL,
  "template_id" uuid,
  "config_snapshot" jsonb NOT NULL,
  "config_version" smallint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "day_log_child_id_log_date_key" UNIQUE ("child_id", "log_date"),
  CONSTRAINT "day_log_id_user_id_key" UNIQUE ("id", "user_id"),
  -- Owner-checked child reference: (child_id, user_id) must match the child
  -- profile row, so a cross-owner child_id is rejected by the database
  -- (AC-04; TR-13). Deleting the child cascades its logs and entries.
  CONSTRAINT "day_log_child_id_user_id_fkey" FOREIGN KEY ("child_id", "user_id")
    REFERENCES "child_profile" ("id", "user_id") ON DELETE CASCADE,
  -- Template provenance: deleting the template nulls ONLY template_id so
  -- user_id and config_snapshot survive (FR-15; PostgreSQL 16 column-list
  -- SET NULL form). Schema.ts approximates this as plain SET NULL; this SQL
  -- and the catalog introspection tests are the source of truth.
  CONSTRAINT "day_log_template_id_user_id_fkey" FOREIGN KEY ("template_id", "user_id")
    REFERENCES "sheet_template" ("id", "user_id") ON DELETE SET NULL (template_id)
);

CREATE TABLE IF NOT EXISTS "care_entry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "day_log_id" uuid NOT NULL REFERENCES "day_log" ("id") ON DELETE CASCADE,
  "item_index" smallint NOT NULL,
  "item_label" varchar(40) NOT NULL,
  "occurred_time" time NOT NULL,
  "value" varchar(64),
  "note" varchar(500),
  "client_key" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- Position in config_snapshot.items (16 items max on a one-day sheet).
  CONSTRAINT "care_entry_item_index_check" CHECK ("item_index" BETWEEN 0 AND 15),
  -- client_key makes creation idempotent: a retried create cannot produce a
  -- second row for the same log (FR-19).
  CONSTRAINT "care_entry_day_log_id_client_key_key" UNIQUE ("day_log_id", "client_key")
);

-- Cloud-only mirrors; the tables exist (empty) in self-host so both modes
-- share exactly one schema (FR-40; ARCH-002 canonical models).
CREATE TABLE IF NOT EXISTS "subscription" (
  "user_id" text PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL UNIQUE,
  "stripe_subscription_id" text UNIQUE,
  "price_id" text NOT NULL,
  "status" text NOT NULL,
  "current_period_end" timestamptz,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "payment_failed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "stripe_event" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  "outcome" text
);

-- Query-path indexes (SPEC §Tables `-- index:` shorthand; TR-04/TR-11).
CREATE INDEX IF NOT EXISTS "child_profile_user_id_created_at_idx"
  ON "child_profile" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "sheet_template_user_id_updated_at_idx"
  ON "sheet_template" ("user_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "day_log_user_id_log_date_id_idx"
  ON "day_log" ("user_id", "log_date" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "day_log_user_id_child_id_log_date_id_idx"
  ON "day_log" ("user_id", "child_id", "log_date" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "care_entry_day_log_id_occurred_time_id_idx"
  ON "care_entry" ("day_log_id", "occurred_time", "id");
