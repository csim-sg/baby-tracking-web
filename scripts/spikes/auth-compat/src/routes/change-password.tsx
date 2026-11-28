import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

export const Route = createFileRoute("/change-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    currentPassword: String(search.currentPassword ?? ""),
    newPassword: String(search.newPassword ?? ""),
    revokeOtherSessions: search.revokeOtherSessions === "true",
  }),
  loader: async ({ location }) => {
    return await runAuthAction({
      data: {
        action: "changePassword",
        currentPassword: location.search.currentPassword,
        newPassword: location.search.newPassword,
        revokeOtherSessions: location.search.revokeOtherSessions,
      },
    });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
