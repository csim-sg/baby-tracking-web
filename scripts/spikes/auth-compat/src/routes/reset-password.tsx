import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: String(search.token ?? ""),
    newPassword: String(search.newPassword ?? ""),
  }),
  loader: async ({ location }) => {
    return await runAuthAction({
      data: {
        action: "resetPassword",
        token: location.search.token,
        newPassword: location.search.newPassword,
      },
    });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
