/**
 * /app layout and session gate (issue #24; FR-08, FR-22, FR-27, FR-44;
 * AC-01/AC-02).
 *
 * The readiness/launch gate for the whole /app subtree lives in the
 * request middleware (src/server/digital-request-middleware.ts — the
 * equivalent of the removed nitro entries; proven by built-server smoke).
 * beforeLoad owns the SESSION boundary: unauthenticated requests are
 * redirected to /sign-in with a LOCAL return path, and cloud users with an
 * unverified email go to the verification-pending state (FR-06) instead of
 * any data surface.
 *
 * The shell renders navigation and the account entry point; child pages
 * render inside the Outlet. No GTM/analytics is loaded here (route-aware
 * root flag) and the TR-14 security headers are applied to every delivered
 * app document by the middleware.
 */
import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";

import { getAppGate } from "../../server/auth/fns";
import type { SessionView } from "../../server/auth/fns";

export type AppRouteContext = {
  session: NonNullable<SessionView>;
  verificationRequired: boolean;
};

export const Route = createFileRoute("/app")({
  beforeLoad: async ({ location }) => {
    const gate = await getAppGate();
    if (gate.kind === "unauthenticated") {
      throw redirect({
        to: "/sign-in",
        search: { return: location.pathname },
      });
    }
    if (gate.kind === "unverified") {
      throw redirect({
        to: "/verify-email",
        search: { token: undefined, status: "pending", email: gate.email },
      });
    }
    return {
      session: gate.session,
      verificationRequired: gate.verificationRequired,
    } satisfies AppRouteContext;
  },
  component: AppShell,
});

function AppShell() {
  const { session } = Route.useRouteContext();
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-[--color-line] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <a
            href="/app"
            className="font-[family-name:var(--font-display)] text-lg font-extrabold text-stone-900"
          >
            Toddlebook
          </a>
          <nav aria-label="App" className="flex items-center gap-4 text-sm">
            <a
              href="/app"
              className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
            >
              Dashboard
            </a>
            <a
              href="/app/settings"
              className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
            >
              Settings
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-xs text-[--color-label-ink]">
        Signed in as {session.user.email}
        {" · "}
        <a
          href="/"
          className="font-medium text-[--color-control-green] underline-offset-2 hover:underline"
        >
          Free printable sheet
        </a>
      </footer>
    </div>
  );
}
