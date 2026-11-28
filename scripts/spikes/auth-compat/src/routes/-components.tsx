import type { AuthOutcome } from "../auth-fns";

export function ResultView({
  outcome,
  extra,
}: {
  outcome: AuthOutcome | null;
  extra?: Record<string, unknown>;
}) {
  return (
    <pre data-testid="result">
      {JSON.stringify({ outcome, extra }, null, 2)}
    </pre>
  );
}
