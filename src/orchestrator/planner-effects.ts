import { briefOf } from "../agents/brief.ts";
import { changeFacts, classify } from "../agents/planner/high-impact.ts";
import { planComment } from "../agents/planner/plan-comment.ts";
import type { Plan } from "../agents/planner/plan.ts";
import { runConfig } from "./limits.ts";
import type { EffectScope } from "./role-effects.ts";
import type { RoleOutcome } from "./role-output.ts";

// Before a version that needs approval, the label of an earlier approval
// goes, so it does not carry over and a new label sends an event (FR-4.5).
export async function clearApproval(scope: EffectScope): Promise<void> {
  const { context, run, issue } = scope;
  await scope.guard.perform("plan approval label removal", () =>
    context.app.issues.removeLabel(issue.number, run.labels.plan_approved),
  );
}

// The Planner's plan as a new numbered comment (FR-4.3, FR-4.6). The job
// classifies it with the run's high-impact criteria (FR-10.5), together with
// what the branch of an earlier run changes (FR-4.28b).
export async function plannerEffects(
  scope: EffectScope,
  plan: Plan,
): Promise<RoleOutcome> {
  const { context, run } = scope;
  const version = run.progress.planVersion + 1;
  const classification = classify(
    plan.highImpact,
    changeFacts(plan, briefOf(scope.brief, "planner")?.branchDiff?.files),
    runConfig(run, context.baseline).high_impact,
  );
  if (classification.highImpact) await clearApproval(scope);
  const body = planComment({
    runId: run.id,
    version,
    plan,
    classification,
    approvalLabel: run.labels.plan_approved,
  });
  await scope.guard.perform("comment", () =>
    context.app.comments.createComment(scope.issue.number, body),
  );
  return { kind: "plan", version, highImpact: classification.highImpact };
}
