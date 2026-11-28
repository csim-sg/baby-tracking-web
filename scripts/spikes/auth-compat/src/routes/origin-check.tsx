import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

/** Origin/CSRF check: forges a disallowed Origin header into Better Auth. */
export const Route = createFileRoute("/origin-check")({
  validateSearch: (search: Record<string, unknown>) => ({
    origin: String(search.origin ?? "https://evil.example"),
  }),
  loader: async ({ location }) => {
    return await runAuthAction({
      data: { action: "originCheck", origin: location.search.origin },
    });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
