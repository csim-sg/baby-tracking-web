/**
 * Drizzle database client over the shared lazy pool (issue #24; ARCH-002
 * `src/server/db` component). Anchored on `globalThis` like the pool and
 * the readiness registry so every bundled server graph shares one instance.
 * Runtime query code imports this plus the typed `schema.ts` mirror.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDatabasePool } from "./pool";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

type GlobalWithDb = typeof globalThis & {
  /** Process-wide Drizzle instance, shared by every bundled copy. */
  __toddlebook_drizzle__?: Db;
};

export function getDb(): Db {
  const store = globalThis as GlobalWithDb;
  const existing = store.__toddlebook_drizzle__;
  if (existing) {
    return existing;
  }
  const created = drizzle(getDatabasePool(), { schema });
  store.__toddlebook_drizzle__ = created;
  return created;
}
