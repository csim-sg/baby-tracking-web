/**
 * Reset-password page (issue #24; FR-07). The reset token arrives as the
 * `?token=` query value written by the server's reset email (the library's
 * own URL form points at the gated, never-mounted /api/auth path). A
 * successful reset revokes every session of the account (F6 pairing).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { resetPassword } from "../../server/auth/fns";
import {
  AuthShell,
  envelopeMessage,
  Field,
  Notice,
  SubmitButton,
} from "../-auth-ui";

export const Route = createFileRoute("/reset-password/")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFields({});
    setMessage(null);
    try {
      const result = await resetPassword({ data: { token, newPassword: password } });
      if (result.ok) {
        setSuccess(true);
      } else {
        setFields(result.error.fields ?? {});
        setMessage(result.error.message);
      }
    } catch (error) {
      setMessage(envelopeMessage(error, "Reset failed. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="All existing sessions are signed out when the password changes."
    >
      {!token && (
        <Notice tone="error">
          This link is missing its reset token. Request a new link from the
          forgot-password page.
        </Notice>
      )}
      {token && (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            label="New password"
            name="new-password"
            type="password"
            value={password}
            onChange={setPassword}
            error={fields.newPassword}
            autoComplete="new-password"
            required
          />
          <p className="text-xs text-stone-500">12–128 characters.</p>
          {message && <Notice tone="error">{message}</Notice>}
          {success && (
            <Notice tone="success">
              Password updated. Everything was signed out — sign in again with
              your new password.
            </Notice>
          )}
          <SubmitButton pending={pending}>Set new password</SubmitButton>
        </form>
      )}
      {(success || !token) && (
        <p className="text-sm">
          <a
            className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
            href="/sign-in"
          >
            Go to sign-in
          </a>
        </p>
      )}
    </AuthShell>
  );
}
