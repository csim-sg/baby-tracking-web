import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

/**
 * FR-08-compliant "revoke all sessions" endpoint used by the harness to
 * demonstrate the pairing pattern (password change / reset + explicit
 * revoke-all) that Better Auth's built-in changePassword does not provide
 * on its own in 1.7.28 (see results/FINDINGS.md C23/C19).
 */
export const Route = createFileRoute("/revoke-all")({
  loader: async () => {
    return await runAuthAction({ data: { action: "revokeSessions" } });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
