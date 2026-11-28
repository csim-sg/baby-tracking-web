/**
 * /app dashboard (issue #24): the child-profile surface. Nickname-only
 * profiles (FR-12), owner-scoped with foreign ids reading as not-found
 * (FR-22), maximum 10 per account, and deletion that warns about the
 * cascade and requires the nickname retyped (FR-36). Templates, logs,
 * entries, billing and export are later slices and are deliberately absent.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { listChildrenFn } from "../../server/care/children-fns";
import {
  createChildFn,
  deleteChildFn,
  updateChildFn,
} from "../../server/care/children-fns";
import { envelopeMessage } from "../-auth-ui";
import type { ChildProfileView } from "../../server/care/children";

export const Route = createFileRoute("/app/")({
  loader: () => listChildrenFn(),
  component: DashboardPage,
});

function DashboardPage() {
  const initial = Route.useLoaderData();
  const [children, setChildren] = useState<ChildProfileView[]>(
    initial.ok ? initial.data : [],
  );
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(
    initial.ok ? null : initial.error.message,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(
    null,
  );
  const [confirming, setConfirming] = useState<{
    child: ChildProfileView;
    confirm: string;
  } | null>(null);

  async function run<T>(
    action: () => Promise<T>,
    onOk: (result: T) => void,
  ): Promise<void> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action().then(onOk);
    } catch (err) {
      setError(envelopeMessage(err, "Something went wrong. Try again."));
    } finally {
      setPending(false);
    }
  }

  async function refreshList(): Promise<void> {
    const result = await listChildrenFn();
    if (result.ok) {
      setChildren(result.data);
    } else {
      setError(result.error.message);
    }
  }

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    await run(
      () => createChildFn({ data: { nickname } }),
      (result) => {
        if (result.ok) {
          setChildren((current) => [...current, result.data]);
          setNickname("");
          setNotice(`Added ${result.data.nickname}.`);
        } else {
          setError(result.error.message);
        }
      },
    );
  }

  async function onRename(event: React.FormEvent) {
    event.preventDefault();
    if (!renaming) {
      return;
    }
    const id = renaming.id;
    await run(
      () => updateChildFn({ data: { id, nickname: renaming.value } }),
      (result) => {
        if (result.ok) {
          setChildren((current) =>
            current.map((child) => (child.id === id ? result.data : child)),
          );
          setRenaming(null);
          setNotice("Profile updated.");
        } else {
          setError(result.error.message);
        }
      },
    );
  }

  async function onDelete(event: React.FormEvent) {
    event.preventDefault();
    if (!confirming) {
      return;
    }
    const child = confirming.child;
    await run(
      () => deleteChildFn({ data: { id: child.id, confirm: confirming.confirm } }),
      (result) => {
        if (result.ok) {
          setChildren((current) => current.filter((c) => c.id !== child.id));
          setConfirming(null);
          setNotice(
            `Deleted ${child.nickname} and its logs and entries.`,
          );
        } else {
          setError(result.error.message);
        }
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="children-heading" className="flex flex-col gap-4">
        <div>
          <h1
            id="children-heading"
            className="font-[family-name:var(--font-display)] text-xl font-extrabold text-stone-900"
          >
            Child profiles
          </h1>
          <p className="text-sm text-stone-600">
            Only a nickname is stored — no names, birthdays, photos, or
            medical details. Up to 10 profiles.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg border border-[--color-active-line] bg-[--color-active-wash] px-3 py-2 text-sm text-[--color-active-green]">
            {notice}
          </p>
        )}

        {children.length === 0 ? (
          <p className="text-sm text-stone-600">
            No child profiles yet — add the first one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {children.map((child) => (
              <li
                key={child.id}
                className="rounded-lg border border-[--color-line] bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium text-stone-900">
                    {child.nickname}
                  </span>
                  <span className="flex gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setRenaming({ id: child.id, value: child.nickname })}
                      className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming({ child, confirm: "" })}
                      className="font-medium text-red-700 underline-offset-2 hover:underline"
                    >
                      Delete
                    </button>
                  </span>
                </div>
                {renaming?.id === child.id && (
                  <form onSubmit={onRename} className="mt-3 flex flex-wrap items-end gap-2">
                    <div>
                      <label
                        htmlFor={`rename-${child.id}`}
                        className="block text-xs font-medium text-stone-700"
                      >
                        New nickname
                      </label>
                      <input
                        id={`rename-${child.id}`}
                        type="text"
                        value={renaming.value}
                        maxLength={40}
                        onChange={(event) =>
                          setRenaming({ id: child.id, value: event.target.value })
                        }
                        className="mt-1 w-56 rounded-lg border border-[--color-control-line] bg-white px-3 py-2 text-sm outline-none focus:border-[--color-control-green] focus:ring-2 focus:ring-[--color-control-green]/30"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={pending}
                      className="rounded-lg bg-[--color-control-green] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(null)}
                      className="rounded-lg border border-[--color-control-line] px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
                    >
                      Cancel
                    </button>
                  </form>
                )}
                {confirming?.child.id === child.id && (
                  <form onSubmit={onDelete} className="mt-3 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm text-red-800">
                      Deleting <strong>{child.nickname}</strong> also deletes
                      all of its day logs and care entries. This cannot be
                      undone.
                    </p>
                    <label
                      htmlFor={`confirm-${child.id}`}
                      className="text-xs font-medium text-red-900"
                    >
                      Type “{child.nickname}” to confirm
                    </label>
                    <input
                      id={`confirm-${child.id}`}
                      type="text"
                      value={confirming.confirm}
                      onChange={(event) =>
                        setConfirming({ child, confirm: event.target.value })
                      }
                      autoComplete="off"
                      className="w-56 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
                      required
                    />
                    <span className="flex gap-2">
                      <button
                        type="submit"
                        disabled={pending}
                        className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        Delete profile
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded-lg border border-[--color-control-line] bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
                      >
                        Cancel
                      </button>
                    </span>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-child-heading" className="flex flex-col gap-3">
        <h2
          id="add-child-heading"
          className="font-[family-name:var(--font-display)] text-lg font-extrabold text-stone-900"
        >
          Add a child profile
        </h2>
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
          <div>
            <label
              htmlFor="new-nickname"
              className="block text-sm font-medium text-stone-800"
            >
              Nickname (1–40 characters)
            </label>
            <input
              id="new-nickname"
              type="text"
              value={nickname}
              maxLength={40}
              onChange={(event) => setNickname(event.target.value)}
              className="mt-1 w-64 rounded-lg border border-[--color-control-line] bg-white px-3 py-2 text-sm outline-none focus:border-[--color-control-green] focus:ring-2 focus:ring-[--color-control-green]/30"
              required
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[--color-control-green] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--color-control-green] disabled:opacity-60"
          >
            Add profile
          </button>
        </form>
      </section>
    </div>
  );
}
