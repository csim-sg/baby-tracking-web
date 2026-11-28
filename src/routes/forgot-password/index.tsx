/**
 * Forgot-password page (issue #24; FR-07). The server function returns the
 * same generic message whether or not the account exists, and on a
 * self-host instance without SMTP the message states the operator-command
 * limitation (FR-09/AC-03).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { forgotPassword } from "../../server/auth/fns";
import {
  AuthShell,
  envelopeMessage,
  Field,
  Notice,
  SubmitButton,
} from "../-auth-ui";

export const Route = createFileRoute("/forgot-password/")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFields({});
    setMessage(null);
    setSuccess(null);
    try {
      const result = await forgotPassword({ data: { email } });
      if (result.ok) {
        setSuccess(result.data.message);
      } else {
        setFields(result.error.fields ?? {});
        setMessage(result.error.message);
      }
    } catch (error) {
      setMessage(envelopeMessage(error, "Request failed. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link that works once and expires in 60 minutes."
      footer={
        <>
          Remembered it?{" "}
          <a
            className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
            href="/sign-in"
          >
            Sign in
          </a>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Email"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          error={fields.email}
          autoComplete="email"
          required
        />
        {message && <Notice tone="error">{message}</Notice>}
        {success && <Notice tone="info">{success}</Notice>}
        <SubmitButton pending={pending}>Send reset link</SubmitButton>
      </form>
    </AuthShell>
  );
}
