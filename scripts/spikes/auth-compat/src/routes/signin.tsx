import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

export const Route = createFileRoute("/signin")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: String(search.email ?? ""),
    password: String(search.password ?? ""),
  }),
  loader: async ({ location }) => {
    return await runAuthAction({
      data: {
        action: "signIn",
        email: location.search.email,
        password: location.search.password,
      },
    });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
