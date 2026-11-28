/**
 * Free-surface fallback for unknown paths (issue #24; preserves the #22/#23
 * catch-all contract asserted by scripts/smoke/runtime-modes.mjs: unknown
 * paths answer 200 text/html like before).
 *
 * The framework renderer returns the router's not-found status (404) for
 * unmatched paths; this splat MATCHES them instead so the free surface keeps
 * its pre-existing behavior. Digital prefixes never reach it — the digital
 * gate middleware answers them first (fail-closed 503/404, explicit 404 for
 * unknown app subpaths). No GTM/analytics here either: the route-aware root
 * flag computes `gtmEnabled` from the pathname (cloud `/` only).
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/$")({
  component: FreeFallbackPage,
});

function FreeFallbackPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 [text-align:center]">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold text-stone-900">
        Page not found
      </h1>
      <p className="text-sm text-stone-600">
        There is nothing at this address.
      </p>
      <a
        href="/"
        className="text-sm font-medium text-[--color-control-green] underline-offset-2 hover:underline"
      >
        Go to the Toddlebook home
      </a>
    </main>
  );
}
