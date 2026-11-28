/**
 * Verify-email page (issue #24; FR-06). Two states:
 * - `?token=…` (from the verification email): consumes the single-use,
 *   24-hour token; with `autoSignInAfterVerification` the library issues
 *   the session during verification.
 * - `?status=pending` (the /app redirect target for an unverified cloud
 *   account): explains the pending state and offers a rate-limited resend.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  verifyEmailToken,
  resendVerification,
} from "../../server/auth/fns";
import {
  AuthShell,
  envelopeMessage,
  Field,
  Notice,
  SubmitButton,
} from "../-auth-ui";

export const Route = createFileRoute("/verify-email/")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
    email: typeof search.email === "string" ? search.email : undefined,
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token, status, email } = Route.useSearch();

  if (token) {
    return <TokenConsumer token={token} />;
  }
  if (status === "pending") {
    return <PendingPanel email={email ?? ""} />;
  }
  return (
    <AuthShell title="Verify your email">
      <Notice tone="info">
        Open the verification link from your inbox. You can request a new one
        from the sign-in flow.
      </Notice>
    </AuthShell>
  );
}

/** Consumes the token once (React StrictMode-safe: ref-guarded). */
function TokenConsumer({ token }: { token: string }) {
  const [state, setState] = useState<
    { kind: "working" } | { kind: "ok" } | { kind: "error"; message: string }
  >({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    verifyEmailToken({ data: { token } })
      .then((result) => {
        if (result.ok) {
          setState({ kind: "ok" });
        } else {
          setState({ kind: "error", message: result.error.message });
        }
      })
      .catch((error: unknown) => {
        setState({
          kind: "error",
          message: envelopeMessage(
            error,
            "This verification link is invalid or has expired.",
          ),
        });
      });
  }, [token]);

  return (
    <AuthShell title="Email verification">
      {state.kind === "working" && <Notice tone="info">Verifying…</Notice>}
      {state.kind === "ok" && (
        <>
          <Notice tone="success">
            Your email is verified. Everything is ready.
          </Notice>
          <p className="text-sm">
            <a
              className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
              href="/app"
            >
              Continue to Toddlebook
            </a>
          </p>
        </>
      )}
      {state.kind === "error" && (
        <>
          <Notice tone="error">{state.message}</Notice>
          <p className="text-sm">
            <a
              className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
              href="/sign-in"
            >
              Back to sign-in
            </a>
          </p>
        </>
      )}
    </AuthShell>
  );
}

function PendingPanel({ email }: { email: string }) {
  const [resendEmail, setResendEmail] = useState(email);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await resendVerification({ data: { email: resendEmail } });
      if (result.ok) {
        setMessage(result.data.message);
      } else {
        setMessage(result.error.message);
      }
    } catch (error) {
      setMessage(envelopeMessage(error, "Could not resend. Try again later."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Verify your email to continue"
      subtitle="Your account must have a verified email address before your data can be accessed."
    >
      <Notice tone="info">
        Open the verification link we emailed you, then continue. The link
        expires after 24 hours.
      </Notice>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Email"
          name="resend-email"
          type="email"
          value={resendEmail}
          onChange={setResendEmail}
          autoComplete="email"
          required
        />
        {message && <Notice tone="info">{message}</Notice>}
        <SubmitButton pending={pending}>Resend verification email</SubmitButton>
      </form>
      <p className="text-sm text-stone-600">
        Wrong account?{" "}
        <a
          className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
          href="/sign-in"
        >
          Sign in with another account
        </a>
      </p>
    </AuthShell>
  );
}
