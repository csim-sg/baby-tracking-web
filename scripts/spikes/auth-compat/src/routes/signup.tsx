import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: String(search.email ?? ""),
    password: String(search.password ?? ""),
    name: String(search.name ?? "Spike User"),
  }),
  loader: async ({ location }) => {
    return await runAuthAction({
      data: {
        action: "signUp",
        email: location.search.email,
        password: location.search.password,
        name: location.search.name,
      },
    });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
