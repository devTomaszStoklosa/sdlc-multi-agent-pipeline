import { briefOf } from "../agents/brief.ts";
import type { DeveloperBrief } from "../agents/developer/brief.ts";
import type { DeveloperWork, PlanUpdate } from "../agents/developer/work.ts";
import { classify } from "../agents/planner/high-impact.ts";
import {
  parsePlanBlock,
  planUpdateComment,
  safeText,
} from "../agents/planner/plan-comment.ts";
import type { PlanFile } from "../agents/planner/plan.ts";
import type { RunWorkspace, WorkspaceChange } from "../git/workspace.ts";
import { matchesGlob } from "../hooks/paths.ts";
import { newRunBranch } from "./branch.ts";
import { commitMessage } from "./developer-commit.ts";
import { runConfig } from "./limits.ts";
import { outOfScopeIssueBody, pullBody, pullBodyIssues } from "./messages.ts";
import { clearApproval } from "./planner-effects.ts";
import type { EffectScope } from "./role-effects.ts";
import type { RoleOutcome } from "./role-output.ts";

// More changed files than any plan may list (MAX_FILES of a plan is 60): a
// session that un-ignored generated files, for example.
const MAX_CHANGED_FILES = 200;

type Failure = Extract<RoleOutcome, { kind: "failed" }>;

function failed(message: string): Failure {
  return { kind: "failed", failure: "infra", message };
}

interface DeveloperScope extends EffectScope {
  workspace: RunWorkspace;
  brief: DeveloperBrief;
}

function developerScope(scope: EffectScope): DeveloperScope {
  const brief = briefOf(scope.brief, "developer");
  if (scope.workspace === undefined || brief === undefined) {
    throw new Error("A Developer job needs its workspace and brief.");
  }
  return { ...scope, workspace: scope.workspace, brief };
}

// What the branch may not change, whatever the session did: nested
// repositories, paths the hooks deny (SEC-9.1) and more files than a plan.
function diffProblem(
  diff: readonly WorkspaceChange[],
  denyPaths: readonly string[],
): string | undefined {
  const nested = diff.filter((change) => change.submodule);
  if (nested.length > 0) {
    return `The branch adds nested repositories: ${nested.map((c) => c.path).join(", ")}`;
  }
  const denied = diff.filter((change) => matchesGlob(change.path, denyPaths));
  if (denied.length > 0) {
    return `The branch changes denied paths: ${denied.map((c) => c.path).join(", ")}`;
  }
  if (diff.length > MAX_CHANGED_FILES) {
    return `The branch changes ${String(diff.length)} files, more than ${String(MAX_CHANGED_FILES)}.`;
  }
  return undefined;
}

// The plan's files with the update's files added or replaced (FR-4.11), so an
// update cannot drop a file of the plan by leaving it out.
function updatedFiles(planBody: string, update: PlanUpdate): PlanFile[] {
  const files = new Map<string, PlanFile>();
  for (const file of parsePlanBlock(planBody)?.files ?? []) {
    files.set(file.path, file);
  }
  for (const file of update.files) files.set(file.path, file);
  return [...files.values()];
}

// A new plan version from the Developer (FR-4.11), classified with the run's
// rules on what the branch really changes. A version that needs approval
// takes the earlier approval's label away first (FR-4.5).
async function publishUpdate(
  scope: DeveloperScope,
  update: PlanUpdate,
  diff: readonly WorkspaceChange[],
): Promise<{ version: number; highImpact: boolean }> {
  const { context, run } = scope;
  const version = run.progress.planVersion + 1;
  const files = updatedFiles(scope.brief.plan.body, update);
  const paths = new Set([
    ...files.map((file) => file.path),
    ...diff.map((change) => change.path),
  ]);
  const classification = classify(
    update.highImpact,
    {
      paths: [...paths],
      changedLines: diff.reduce((sum, c) => sum + c.additions + c.deletions, 0),
    },
    runConfig(run, context.baseline).high_impact,
  );
  if (classification.highImpact) await clearApproval(scope);
  const body = planUpdateComment({
    runId: run.id,
    version,
    reason: update.reason,
    changed: update.files,
    files,
    classification,
    approvalLabel: run.labels.plan_approved,
  });
  await scope.guard.perform("comment", () =>
    context.app.comments.createComment(scope.issue.number, body),
  );
  return { version, highImpact: classification.highImpact };
}

// Problems outside the issue go to new issues, not into this pull request
// (FR-4.10).
async function openOutOfScope(
  scope: DeveloperScope,
  entries: DeveloperWork["outOfScope"],
): Promise<number[]> {
  const numbers: number[] = [];
  for (const entry of entries) {
    const created = await scope.guard.perform("out-of-scope issue", () =>
      scope.context.app.issues.createIssue(
        safeText(entry.title),
        outOfScopeIssueBody(
          safeText(entry.body),
          scope.run.id,
          scope.issue.number,
        ),
      ),
    );
    numbers.push(created.number);
  }
  return numbers;
}

// The draft pull request after the first push (FR-4.8), or the new issues
// out of scope added to the body of the existing one (FR-4.10).
async function pullRequest(
  scope: DeveloperScope,
  facts: { branch: string; summary: string; issues: number[]; title: string },
): Promise<number> {
  const { context, run, issue } = scope;
  const { pulls } = context.app;
  const existing = run.pr;
  if (existing !== undefined) {
    if (facts.issues.length > 0) {
      const { body } = await pulls.getPull(existing);
      await scope.guard.perform("pull request body", () =>
        pulls.updatePullBody(
          existing,
          `${body}${pullBodyIssues(facts.issues)}`,
        ),
      );
    }
    return existing;
  }
  const main = await context.app.contents.defaultBranch();
  const created = await scope.guard.perform("draft pull request", () =>
    pulls.createDraftPull({
      head: facts.branch,
      base: main.name,
      title: facts.title,
      body: pullBody({
        issue: issue.number,
        runId: run.id,
        summary: safeText(facts.summary),
        plan: scope.brief.plan,
        issues: facts.issues,
        previousPr: scope.previousPr,
      }),
    }),
  );
  return created.number;
}

// The side effects of a Developer stage (plan 3.2): the job commits the
// session's changes, checks the branch, publishes a plan update, opens the
// issues out of scope, pushes and opens the draft pull request, each side
// effect on GitHub after the check of FR-4.28c.
export async function developerEffects(
  given: EffectScope,
  work: DeveloperWork,
): Promise<RoleOutcome> {
  const scope = developerScope(given);
  const { context, run, issue, workspace } = scope;
  const unresolved = await workspace.unresolved(scope.brief.conflicts);
  if (unresolved.length > 0) {
    return failed(`Conflict markers remain in: ${unresolved.join(", ")}`);
  }
  const message = commitMessage(work.commit, issue.number);
  if (!(await workspace.commit(message))) {
    return failed("The Developer session changed no file.");
  }
  const main = await context.app.contents.defaultBranch();
  const diff = await workspace.diff(main.name);
  const problem = diffProblem(
    diff,
    runConfig(run, context.baseline).hooks.deny_paths,
  );
  if (problem !== undefined) return failed(problem);
  const update =
    work.planUpdate && (await publishUpdate(scope, work.planUpdate, diff));
  // A high-impact update waits for approval before anything is pushed.
  if (update && update.highImpact) {
    return { kind: "plan-update", version: update.version, highImpact: true };
  }
  const issues = await openOutOfScope(scope, work.outOfScope);
  const branch =
    run.branch ??
    (await newRunBranch(
      { type: work.commit.type, issue: issue.number, title: issue.title },
      (name) => context.app.contents.branchExists(name),
    ));
  const sha = await scope.guard.perform("push", () => workspace.push(branch));
  const pr = await pullRequest(scope, {
    branch,
    summary: work.summary,
    issues,
    title: message.split("\n")[0] ?? message,
  });
  return { kind: "pushed", sha, branch, pr, planVersion: update?.version };
}
