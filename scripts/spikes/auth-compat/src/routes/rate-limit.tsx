import { createFileRoute } from "@tanstack/react-router";
import { runAuthAction } from "../auth-fns";
import { ResultView } from "./-components";

/** Rate-limit probe: rapid failed sign-ins from one simulated source IP. */
export const Route = createFileRoute("/rate-limit")({
  validateSearch: (search: Record<string, unknown>) => ({
    probeCount: Number(search.probeCount ?? 25),
    probeIp: String(search.probeIp ?? "203.0.113.7"),
  }),
  loader: async ({ location }) => {
    return await runAuthAction({
      data: {
        action: "rateLimitProbe",
        probeCount: location.search.probeCount,
        probeIp: location.search.probeIp,
      },
    });
  },
  component: () => <ResultView outcome={Route.useLoaderData()} />,
});
