import type { RoleBrief } from "../agents/brief.ts";
import type { RoleOutput, RoleResult } from "../agents/role-runner.ts";
import type { Run } from "../core/run-store/run-record.ts";
import type { RunWorkspace } from "../git/workspace.ts";
import { completeAgentReview } from "./agent-review.ts";
import type { JobContext } from "./context.ts";
import { developerEffects } from "./developer-effects.ts";
import type { RunGuard } from "./guard.ts";
import { plannerEffects } from "./planner-effects.ts";
import { reviewerEffects } from "./reviewer-effects.ts";
import type { RoleOutcome } from "./role-output.ts";

export interface EffectScope {
  context: JobContext;
  guard: RunGuard;
  run: Run;
  issue: { number: number; title: string; body: string };
  // The in-progress `agent-review` check run of a Reviewer job.
  checkRunId?: number;
  // What the job gathered for the session.
  brief?: RoleBrief;
  // The workspace of a Developer job, which the job commits and pushes.
  workspace?: RunWorkspace;
  // The pull request of an earlier run, which a new one links (FR-4.28b).
  previousPr?: number;
}

// The side effects of a session's validated result, each after the check of
// FR-4.28c (plan 3.2).
export async function performOutput(
  scope: EffectScope,
  output: RoleOutput,
): Promise<RoleOutcome> {
  switch (output.role) {
    case "planner":
      return plannerEffects(scope, output.plan);
    case "developer":
      return developerEffects(scope, output.work);
    case "reviewer":
      return reviewerEffects(scope, output.review);
  }
}

export async function performFailure(
  scope: EffectScope,
  result:
    | Extract<RoleResult, { status: "failed" }>
    | { failure: "time"; message: string; resetsAt?: undefined },
): Promise<RoleOutcome> {
  await completeAgentReview(scope, "cancelled", {
    title: "Review przerwany",
    summary: `Etap Reviewera w przebiegu ${scope.run.id} nie dał werdyktu: ${result.failure}.`,
  });
  return {
    kind: "failed",
    failure: result.failure,
    message: result.message,
    resetsAt: result.resetsAt,
  };
}
