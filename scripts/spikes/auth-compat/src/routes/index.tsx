import { createFileRoute } from "@tanstack/react-router";
import { getSessionInfo } from "../auth-fns";

/**
 * SSR session-cookie check (AC-02 / FR-08):
 * the loader runs a TanStack Start server function during SSR that reads the
 * Better Auth database-backed session from the incoming Cookie header.
 * The verify script asserts on the SPIKE_ markers in the server-rendered HTML.
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    return await getSessionInfo();
  },
  component: Home,
});

function Home() {
  const session = Route.useLoaderData();
  const state = session?.authenticated
    ? `SPIKE_SESSION_USER:${session.user?.email};verified=${session.user?.emailVerified};expires=${session.session?.expiresAt ?? ""}`
    : "SPIKE_ANONYMOUS";
  return (
    <main>
      <h1>auth-compat-spike</h1>
      <p data-testid="session-state">{state}</p>
      <pre data-testid="result">{JSON.stringify(session, null, 2)}</pre>
    </main>
  );
}
