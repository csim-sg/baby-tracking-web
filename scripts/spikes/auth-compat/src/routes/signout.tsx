import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

export const Route = createFileRoute("/signout")({
  loader: async () => {
    return await runAuthAction({ data: { action: "signOut" } });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
