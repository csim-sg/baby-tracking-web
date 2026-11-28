-- Rate-limit counter table (issue #24; ADR-002 §1 control 2; carry-forward #6).
--
-- ADR-002 mandates a PostgreSQL-backed rate limiter "in the same schema"
-- keyed per IP and per email/action, and T1 finding F4 proved the auth
-- library's limiter cannot run on this stack. This table is an
-- APPLICATION-OWNED operational counter table — the one deliberate exception
-- to "no tables outside the SPEC set", disclosed here and in
-- src/server/db/README.md. SPEC's export contract already excludes
-- "internal rate-limit state"; this table must never appear in the FR-35
-- export (#28).
--
-- Storage rules (tech-lead-approved shape):
-- - `key` is a SHA-256 hex digest of `action-scope:identifier` — NO email or
--   IP address is stored in clear, and there is NO owner foreign key.
-- - `window_start`/`count` implement a fixed-window counter; consumers
--   reset/increment atomically via a single upsert.
--
-- Conventions preserved from 0001: idempotent (IF NOT EXISTS), forward-only,
-- transactional as a whole (scripts/migrate.mjs wraps the file in one
-- transaction), no seed rows, no migration-state bookkeeping.

CREATE TABLE IF NOT EXISTS "rate_limit" (
  "key" text PRIMARY KEY,
  "window_start" timestamptz NOT NULL DEFAULT now(),
  "count" integer NOT NULL DEFAULT 0
);

-- Hygiene sweep support: opportunistic pruning deletes rows whose windows
-- ended more than a day ago (src/server/auth/rate-limit.ts).
CREATE INDEX IF NOT EXISTS "rate_limit_window_start_idx"
  ON "rate_limit" ("window_start");
