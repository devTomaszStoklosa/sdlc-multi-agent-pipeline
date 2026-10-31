import type { RoleBrief } from "../agents/brief.ts";
import type { RoleOutput, RoleResult } from "../agents/role-runner.ts";
import type { Run } from "../core/run-store/run-record.ts";
import type { RunWorkspace } from "../git/workspace.ts";
import type { JobContext } from "./context.ts";
import { developerEffects } from "./developer-effects.ts";
import type { RunGuard } from "./guard.ts";
import { plannerEffects } from "./planner-effects.ts";
import type { RoleOutcome } from "./role-output.ts";

export const AGENT_REVIEW = "agent-review";

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

async function completeReview(
  scope: EffectScope,
  verdict: "approve" | "changes_requested" | "failed",
): Promise<void> {
  if (scope.checkRunId === undefined) return;
  const conclusion = {
    approve: "success",
    changes_requested: "failure",
    failed: "cancelled",
  } as const;
  const id = scope.checkRunId;
  await scope.guard.perform("agent-review result", () =>
    scope.context.app.checks.completeCheckRun(id, conclusion[verdict], {
      title: {
        approve: "approve",
        changes_requested: "changes_requested",
        failed: "Review przerwany",
      }[verdict],
      summary: `Werdykt zaślepki Reviewera w przebiegu ${scope.run.id}.`,
    }),
  );
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
    case "reviewer": {
      await completeReview(scope, output.verdict);
      const blockingFindings = output.findings
        .filter((finding) => finding.blocking)
        .map((finding) => finding.id);
      return { kind: "verdict", verdict: output.verdict, blockingFindings };
    }
  }
}

export async function performFailure(
  scope: EffectScope,
  result:
    | Extract<RoleResult, { status: "failed" }>
    | { failure: "time"; message: string; resetsAt?: undefined },
): Promise<RoleOutcome> {
  await completeReview(scope, "failed");
  return {
    kind: "failed",
    failure: result.failure,
    message: result.message,
    resetsAt: result.resetsAt,
  };
}
