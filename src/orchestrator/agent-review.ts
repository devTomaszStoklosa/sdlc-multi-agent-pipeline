import type { CheckConclusion, CheckOutput } from "../github/ports.ts";
import type { EffectScope } from "./role-effects.ts";

// The check run of the Reviewer's verdict, a required check of the main
// branch whose only source is the pipeline's app (FR-6.2, FR-6.3).
export const AGENT_REVIEW = "agent-review";

// Completes the in-progress check run of a Reviewer job, if it has one.
export async function completeAgentReview(
  scope: Pick<EffectScope, "checkRunId" | "guard" | "context">,
  conclusion: CheckConclusion,
  output: CheckOutput,
): Promise<void> {
  const id = scope.checkRunId;
  if (id === undefined) return;
  await scope.guard.perform("agent-review result", () =>
    scope.context.app.checks.completeCheckRun(id, conclusion, output),
  );
}
