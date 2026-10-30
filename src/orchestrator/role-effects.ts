import type { RoleBrief } from "../agents/brief.ts";
import type { RoleOutput, RoleResult } from "../agents/role-runner.ts";
import type { Run } from "../core/run-store/run-record.ts";
import { newStubBranch } from "./branch.ts";
import type { JobContext } from "./context.ts";
import type { RunGuard } from "./guard.ts";
import { planUpdateComment } from "./messages.ts";
import { clearApproval, plannerEffects } from "./planner-effects.ts";
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
}

type Change = Extract<RoleOutput, { role: "developer" }>["change"];

// The Developer's push and its draft pull request (FR-4.7, FR-4.8). From P6
// on, the job pushes the session's commits with git instead.
async function push(
  scope: EffectScope,
  change: Extract<Change, { kind: "push" }>,
): Promise<RoleOutcome> {
  const { context, guard, run, issue } = scope;
  const { contents, pulls } = context.app;
  const branch =
    run.branch ??
    (await newStubBranch(issue.number, (name) => contents.branchExists(name)));
  const main = await contents.defaultBranch();
  if (!(await contents.branchExists(branch))) {
    await guard.perform("branch", () =>
      contents.createBranch(branch, main.sha),
    );
  }
  const sha = await guard.perform("push", () =>
    contents.writeFile({ branch, ...change }),
  );
  let pr = run.pr;
  if (pr === undefined) {
    const created = await guard.perform("draft pull request", () =>
      pulls.createDraftPull({
        head: branch,
        base: main.name,
        title: `Zaślepka P4: ${issue.title}`,
        body: `Closes #${String(issue.number)}\n\nPR przebiegu ${run.id} na zaślepkach ról (P4).`,
      }),
    );
    pr = created.number;
  }
  return { kind: "pushed", sha, branch, pr };
}

async function comment(scope: EffectScope, body: string): Promise<void> {
  await scope.guard.perform("comment", () =>
    scope.context.app.comments.createComment(scope.issue.number, body),
  );
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

async function developerEffects(
  scope: EffectScope,
  change: Change,
): Promise<RoleOutcome> {
  if (change.kind === "push") return push(scope, change);
  const version = scope.run.progress.planVersion + 1;
  if (change.highImpact) await clearApproval(scope);
  await comment(scope, planUpdateComment(version, change.text));
  return { kind: "plan-update", version, highImpact: change.highImpact };
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
      return developerEffects(scope, output.change);
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
