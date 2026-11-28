import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: String(search.token ?? ""),
  }),
  loader: async ({ location }) => {
    return await runAuthAction({
      data: { action: "verifyEmail", token: location.search.token },
    });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
