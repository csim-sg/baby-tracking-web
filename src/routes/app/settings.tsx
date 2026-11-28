/**
 * /app settings (issue #24): the account-settings entry point — account
 * email display, password change (with the explicit F5 session-revocation
 * pairing), sign-out and sign-out-all (FR-08/FR-11). Export and account
 * deletion are later slices and are deliberately absent.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
  getAppGate,
  signOut,
  signOutAll,
  changePassword,
} from "../../server/auth/fns";
import { envelopeMessage, Field, Notice, SubmitButton } from "../-auth-ui";

export const Route = createFileRoute("/app/settings")({
  loader: () => getAppGate(),
  component: SettingsPage,
});

function SettingsPage() {
  const gate = Route.useLoaderData();
  const session = gate.kind === "ok" ? gate.session : null;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [pending, setPending] = useState(false);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);

  if (!session) {
    // The layout gate guarantees a session; this is a type-narrowing fallback.
    return <Notice tone="error">Not signed in.</Notice>;
  }

  async function onChangePassword(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFields({});
    setMessage(null);
    setChanged(false);
    try {
      const result = await changePassword({
        data: { currentPassword, newPassword },
      });
      if (result.ok) {
        // Every session was revoked (F5 pairing): the current cookie is dead,
        // so the user must sign in again. Full-document navigation (FR-03).
        window.location.assign("/sign-in?return=%2Fapp");
        return;
      }
      setFields(result.error.fields ?? {});
      setMessage(result.error.message);
    } catch (error) {
      setMessage(envelopeMessage(error, "Could not change password."));
    } finally {
      setPending(false);
    }
  }

  async function onSignOut(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await signOut();
      window.location.assign("/");
    } catch (error) {
      setSignOutNotice(envelopeMessage(error, "Sign-out failed. Try again."));
      setPending(false);
    }
  }

  async function onSignOutAll(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await signOutAll();
      window.location.assign("/");
    } catch (error) {
      setSignOutNotice(envelopeMessage(error, "Sign-out failed. Try again."));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="account-heading" className="flex flex-col gap-2">
        <h1
          id="account-heading"
          className="font-[family-name:var(--font-display)] text-xl font-extrabold text-stone-900"
        >
          Account
        </h1>
        <p className="text-sm text-stone-700">
          {session.user.email}
          {gate.kind === "ok" && gate.verificationRequired && (
            session.user.emailVerified ? (
              <span className="ml-2 rounded-full border border-[--color-active-line] bg-[--color-active-wash] px-2 py-0.5 text-xs font-medium text-[--color-active-green]">
                verified
              </span>
            ) : null
          )}
        </p>
      </section>

      <section aria-labelledby="password-heading" className="flex flex-col gap-4">
        <h2
          id="password-heading"
          className="font-[family-name:var(--font-display)] text-lg font-extrabold text-stone-900"
        >
          Change password
        </h2>
        <p className="text-sm text-stone-600">
          Changing your password signs you out on every device.
        </p>
        <form onSubmit={onChangePassword} className="flex max-w-sm flex-col gap-4" noValidate>
          <Field
            label="Current password"
            name="current-password"
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            error={fields.currentPassword}
            autoComplete="current-password"
            required
          />
          <Field
            label="New password"
            name="settings-new-password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            error={fields.newPassword}
            autoComplete="new-password"
            required
          />
          <p className="text-xs text-stone-500">12–128 characters.</p>
          {message && <Notice tone="error">{message}</Notice>}
          <SubmitButton pending={pending}>Change password</SubmitButton>
        </form>
      </section>

      <section aria-labelledby="sessions-heading" className="flex flex-col gap-4">
        <h2
          id="sessions-heading"
          className="font-[family-name:var(--font-display)] text-lg font-extrabold text-stone-900"
        >
          Sessions
        </h2>
        {signOutNotice && <Notice tone="error">{signOutNotice}</Notice>}
        <div className="flex flex-wrap gap-2">
          <form onSubmit={onSignOut}>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-[--color-control-line] bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60"
            >
              Sign out
            </button>
          </form>
          <form onSubmit={onSignOutAll}>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-[--color-control-line] bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60"
            >
              Sign out everywhere
            </button>
          </form>
        </div>
        <p className="text-xs text-stone-500">
          “Sign out everywhere” revokes every session on every device.
        </p>
      </section>
    </div>
  );
}
