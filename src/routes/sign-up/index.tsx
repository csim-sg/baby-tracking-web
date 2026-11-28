/**
 * Sign-up page (issue #24; FR-05/FR-06). Email is trimmed + lowercased at
 * the server-function boundary; the response is the mode-uniform generic
 * message (duplicate emails are never distinguished, F7/C08). On a
 * self-host instance without SMTP the page states the operator limitation
 * up front (FR-06/AC-03).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { getAuthFlags, signUp } from "../../server/auth/fns";
import { safeReturnPath } from "../../server/auth/email";
import {
  AuthShell,
  envelopeMessage,
  Field,
  Notice,
  SubmitButton,
} from "../-auth-ui";

export const Route = createFileRoute("/sign-up/")({
  validateSearch: (search: Record<string, unknown>) => ({
    return: typeof search.return === "string" ? search.return : undefined,
  }),
  loader: () => getAuthFlags(),
  component: SignUpPage,
});

function SignUpPage() {
  const { return: returnParam } = Route.useSearch();
  const flags = Route.useLoaderData();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      const result = await signUp({ data: { email, password } });
      if (result.ok) {
        setSuccess(result.data.message);
      } else {
        setFields(result.error.fields ?? {});
        setMessage(result.error.message);
      }
    } catch (error) {
      setMessage(envelopeMessage(error, "Sign-up failed. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="A private log for your child's care."
      footer={
        <>
          Already have an account?{" "}
          <a
            className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
            href={
              returnParam
                ? `/sign-in?return=${encodeURIComponent(returnParam)}`
                : "/sign-in"
            }
          >
            Sign in
          </a>
        </>
      }
    >
      {!flags.verificationRequired && (
        <Notice tone="info">
          This instance does not send email: accounts are created without
          email verification, and a forgotten password can only be reset by
          the operator's recovery command.
        </Notice>
      )}
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
        <Field
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          error={fields.password}
          autoComplete="new-password"
          required
        />
        <p className="text-xs text-stone-500">
          12–128 characters. Use something unique.
        </p>
        {message && <Notice tone="error">{message}</Notice>}
        {success && <Notice tone="success">{success}</Notice>}
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
      {success && (
        <p className="text-sm">
          <a
            className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
            href={
              returnParam
                ? `/sign-in?return=${encodeURIComponent(returnParam)}`
                : "/sign-in"
            }
          >
            Go to sign-in
          </a>
        </p>
      )}
    </AuthShell>
  );
}
