/**
 * Sign-in page (issue #24; FR-05). The route is fail-closed at its
 * beforeLoad: when the digital surface is not ready the request receives
 * the gate 503, when launch-disabled the 404 — never the SSR catch-all.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { signIn } from "../../server/auth/fns";
import { safeReturnPath } from "../../server/auth/email";
import {
  AuthShell,
  envelopeMessage,
  Field,
  Notice,
  SubmitButton,
} from "../-auth-ui";

export const Route = createFileRoute("/sign-in/")({
  validateSearch: (search: Record<string, unknown>) => ({
    return: typeof search.return === "string" ? search.return : undefined,
  }),
  component: SignInPage,
});

function SignInPage() {
  const { return: returnParam } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFields({});
    setMessage(null);
    try {
      const result = await signIn({ data: { email, password } });
      if (result.ok) {
        // Full-document navigation onto the app surface (FR-03: the GTM
        // container must not persist).
        window.location.assign(safeReturnPath(returnParam, "/app"));
        return;
      }
      setFields(result.error.fields ?? {});
      setMessage(result.error.message);
    } catch (error) {
      setMessage(envelopeMessage(error, "Sign-in failed. Try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Your care logs live behind your account."
      footer={
        <>
          No account yet?{" "}
          <a
            className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
            href={
              returnParam
                ? `/sign-up?return=${encodeURIComponent(returnParam)}`
                : "/sign-up"
            }
          >
            Create one
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
        <Field
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          error={fields.password}
          autoComplete="current-password"
          required
        />
        {message && <Notice tone="error">{message}</Notice>}
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
      <p className="text-sm text-stone-600">
        <a
          className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
          href="/forgot-password"
        >
          Forgot your password?
        </a>
      </p>
    </AuthShell>
  );
}
