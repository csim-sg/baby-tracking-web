import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

export const Route = createFileRoute("/forget-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: String(search.email ?? ""),
  }),
  loader: async ({ location }) => {
    return await runAuthAction({
      data: { action: "forgetPassword", email: location.search.email },
    });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
