/**
 * Child-profile server functions (issue #24; SPEC §Server operations
 * `children.*`; FR-22 owner scoping; AC-04).
 *
 * Composition order (ARCH-002): readiness gate → session → owner → care
 * service with `ownerId`. The owner is ALWAYS the session's user id — child
 * ids never select the owner. Mutations run `guardMutation("app")`
 * (readiness → same-origin → body bound) before anything else.
 *
 * Delete requires an explicit confirmation input: the caller must retype
 * the profile's exact nickname (FR-36 "MUST warn … and MUST require
 * explicit confirmation"; the UI warns that logs and entries will be
 * deleted and the server rejects a non-matching confirmation).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { guardMutation, throwUnlessSurfaceReady } from "../auth/guard";
import { getAuthInstance } from "../auth/instance";
import {
  createChild,
  deleteChild,
  listChildren,
  updateChild,
  type ChildProfileView,
} from "./children";
import {
  notFoundError,
  unauthenticatedError,
  validationError,
  type Envelope,
} from "../envelope";

async function currentUserId(): Promise<string | null> {
  const headers = new Headers(getRequest()?.headers ?? new Headers());
  try {
    const session = await getAuthInstance().api.getSession({ headers });
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

/** A well-formed child-profile id (uuid); anything else reads as missing. */
function isChildId(raw: unknown): raw is string {
  return typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw);
}

/** `children.list` (read): the owner's profiles. */
export const listChildrenFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Envelope<ChildProfileView[]>> => {
    await throwUnlessSurfaceReady("app");
    const userId = await currentUserId();
    if (!userId) {
      return unauthenticatedError();
    }
    return { ok: true, data: await listChildren(userId) };
  },
);

/** `children.create` (write): nickname 1–40; cap 10. */
export const createChildFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { nickname?: string })
  .handler(async ({ data }): Promise<Envelope<ChildProfileView>> => {
    await guardMutation("app");
    const userId = await currentUserId();
    if (!userId) {
      return unauthenticatedError();
    }
    return createChild(userId, data.nickname);
  });

/** `children.update` (write): owned id + nickname; foreign id → 404. */
export const updateChildFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { id?: string; nickname?: string })
  .handler(async ({ data }): Promise<Envelope<ChildProfileView>> => {
    await guardMutation("app");
    const userId = await currentUserId();
    if (!userId) {
      return unauthenticatedError();
    }
    if (!isChildId(data.id)) {
      return notFoundError();
    }
    return updateChild(userId, data.id, data.nickname);
  });

/**
 * `children.delete` (delete): owned id + explicit confirmation (the exact
 * nickname); foreign id → 404 even when a matching nickname is supplied.
 */
export const deleteChildFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => d as { id?: string; confirm?: string })
  .handler(
    async ({ data }): Promise<Envelope<{ deleted: true }>> => {
      await guardMutation("app");
      const userId = await currentUserId();
      if (!userId) {
        return unauthenticatedError();
      }
      const confirm = typeof data.confirm === "string" ? data.confirm : "";
      if (!isChildId(data.id)) {
        return notFoundError();
      }
      const id = data.id;
      // The confirmation must match the profile's nickname exactly. Resolved
      // owner-scoped, so a foreign id still reads as NOT_FOUND.
      const owned = await listChildren(userId);
      const target = owned.find((child) => child.id === id);
      if (!target) {
        return notFoundError();
      }
      if (confirm !== target.nickname) {
        return validationError(
          {
            confirm:
              "Type the nickname exactly to confirm deletion (its logs and entries will be deleted).",
          },
          "Type the nickname exactly to confirm deletion.",
        );
      }
      return deleteChild(userId, id);
    },
  );
