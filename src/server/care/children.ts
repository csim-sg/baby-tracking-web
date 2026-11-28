/**
 * Owner-scoped child-profile service (issue #24; FR-12, FR-22, FR-36;
 * AC-04; ARCH-002 canonical model `child_profile`).
 *
 * Plain server-side functions over the #23 schema via Drizzle. The OWNER
 * always comes from the session (never from input); every query filters by
 * `user_id`; a foreign id is indistinguishable from a missing one —
 * NOT_FOUND (FR-22; SPEC error envelope: cross-owner is never a
 * distinguishable forbidden response).
 *
 * Rules enforced here (FR-12): nickname 1–40 characters (trimmed),
 * nickname-only fields (the schema has no others), maximum 10 profiles per
 * account — the SPEC puts the cap in the service layer. The cap check and
 * the insert run in ONE transaction serialized by a per-owner advisory
 * lock, so concurrent creates cannot exceed 10 by racing the count.
 *
 * Deleting a child cascades its logs and entries at the database level
 * (0001 composite FK `ON DELETE CASCADE`) — verified at SQL level by the
 * integration tests. FR-36's explicit confirmation is enforced in the
 * server-function wrapper (`children-fns.ts`), which requires the caller
 * to retype the nickname.
 *
 * This module imports no Stripe, no billing, and no deployment mode
 * (ARCH-002 care-service boundary).
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { childProfiles } from "../db/schema";
import {
  limitError,
  notFoundError,
  validationError,
  type Envelope,
} from "../envelope";

/** FR-12: an account MAY create up to 10 child profiles. */
export const MAX_CHILDREN = 10;

export type ChildProfileView = {
  id: string;
  nickname: string;
  createdAt: string;
  updatedAt: string;
};

/** Nickname rule (FR-12): 1–40 characters after trimming. */
export function validateNickname(
  raw: unknown,
): { nickname: string } | { problem: string } {
  if (typeof raw !== "string") {
    return { problem: "Nickname is required." };
  }
  const nickname = raw.trim();
  if (nickname.length < 1) {
    return { problem: "Nickname must be at least 1 character." };
  }
  if (nickname.length > 40) {
    return { problem: "Nickname must be at most 40 characters." };
  }
  return { nickname };
}

function toView(row: typeof childProfiles.$inferSelect): ChildProfileView {
  return {
    id: row.id,
    nickname: row.nickname,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The owner's child profiles, oldest first (at most MAX_CHILDREN). */
export async function listChildren(ownerId: string): Promise<ChildProfileView[]> {
  const rows = await getDb()
    .select()
    .from(childProfiles)
    .where(eq(childProfiles.userId, ownerId))
    .orderBy(asc(childProfiles.createdAt), asc(childProfiles.id))
    .limit(MAX_CHILDREN);
  return rows.map(toView);
}

/**
 * Creates a profile for the owner. `LIMIT` once the account already holds
 * MAX_CHILDREN (SPEC: "Created profile; limit error at 10").
 */
export async function createChild(
  ownerId: string,
  rawNickname: unknown,
): Promise<Envelope<ChildProfileView>> {
  const validated = validateNickname(rawNickname);
  if ("problem" in validated) {
    return validationError({ nickname: validated.problem });
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    // Serialize the count+insert per owner so two concurrent creates cannot
    // both pass the cap (PostgreSQL advisory lock, released with the
    // transaction).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended('toddlebook:child_limit:' || ${ownerId}, 42))`,
    );
    const counted = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(childProfiles)
      .where(eq(childProfiles.userId, ownerId));
    if ((counted[0]?.total ?? 0) >= MAX_CHILDREN) {
      return limitError(
        `You can keep up to ${MAX_CHILDREN} child profiles.`,
      );
    }
    const inserted = await tx
      .insert(childProfiles)
      .values({ userId: ownerId, nickname: validated.nickname })
      .returning();
    const row = inserted[0];
    if (!row) {
      return { ok: false as const, error: {
        code: "INTERNAL" as const,
        message: "Could not create the profile. Try again.",
      } };
    }
    return { ok: true as const, data: toView(row) };
  });
}

/**
 * Updates the nickname of an OWNED profile; a foreign/unknown id is 404
 * (`unique (id, user_id)` in the #23 schema is the second barrier).
 */
export async function updateChild(
  ownerId: string,
  childId: string,
  rawNickname: unknown,
): Promise<Envelope<ChildProfileView>> {
  const validated = validateNickname(rawNickname);
  if ("problem" in validated) {
    return validationError({ nickname: validated.problem });
  }
  const updated = await getDb()
    .update(childProfiles)
    .set({ nickname: validated.nickname, updatedAt: new Date() })
    .where(
      and(eq(childProfiles.id, childId), eq(childProfiles.userId, ownerId)),
    )
    .returning();
  const row = updated[0];
  if (!row) {
    return notFoundError();
  }
  return { ok: true, data: toView(row) };
}

/**
 * Deletes an OWNED profile. The database cascades its day logs and entries
 * (FR-36/SPEC §Deletion); the caller must have provided the explicit
 * confirmation (enforced in children-fns.ts).
 */
export async function deleteChild(
  ownerId: string,
  childId: string,
): Promise<Envelope<{ deleted: true }>> {
  const deleted = await getDb()
    .delete(childProfiles)
    .where(
      and(eq(childProfiles.id, childId), eq(childProfiles.userId, ownerId)),
    )
    .returning({ id: childProfiles.id });
  if (deleted.length === 0) {
    return notFoundError();
  }
  return { ok: true, data: { deleted: true } };
}
