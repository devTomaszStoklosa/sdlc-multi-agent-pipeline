import type { RoleBrief } from "../agents/brief.ts";
import type { RoleRunner } from "../agents/role-runner.ts";
import type { Run, RunRecord } from "../core/run-store/run-record.ts";
import { roleOf } from "../core/state-machine/states.ts";
import type { RunWorkspace } from "../git/workspace.ts";
import type { CommandRunner } from "../hooks/commands.ts";
import type { Role } from "../hooks/roles.ts";
import { guardFor, type JobContext } from "./context.ts";
import { developerBrief } from "./developer-brief.ts";
import { RunInactiveError } from "./guard.ts";
import { StageError } from "./stage-error.ts";
import { remainingMinutes, runLimits } from "./limits.ts";
import { plannerBrief } from "./planner-brief.ts";
import { AGENT_REVIEW } from "./agent-review.ts";
import { reviewerBrief } from "./reviewer-brief.ts";
import {
  performFailure,
  performOutput,
  type EffectScope,
} from "./role-effects.ts";
import type { RoleJobOutput, RoleOutcome } from "./role-output.ts";
import { watchForStop, type Wait } from "./stop-watch.ts";
import { NO_USAGE, session, type Session } from "./stage-session.ts";

export interface RoleJobContext extends JobContext {
  runner: RoleRunner;
  stopWatch: { intervalMs: number; wait: Wait };
  // The pipeline's app, the author of its own comments, and its bot, the
  // author of its reviews.
  appId: number;
  appLogin: string;
  // The checkout of the connected repository and its install command, for a
  // Developer job.
  workspace: RunWorkspace;
  installer: CommandRunner;
  // The name of the repository's gates workflow (plan 3.5).
  gatesWorkflow: string;
}

type Brief = (context: RoleJobContext, record: RunRecord) => Promise<RoleBrief>;

// What the job gathers for a role before its session (SEC-8.10).
const BRIEFS: Record<Role, Brief> = {
  planner: (context, record) =>
    plannerBrief(
      {
        comments: context.app.comments,
        permissions: context.app.permissions,
        pulls: context.read.pulls,
        contents: context.app.contents,
        appId: context.appId,
        repository: context.repository,
      },
      record,
    ),
  developer: (context, record) =>
    developerBrief(
      {
        comments: context.app.comments,
        reviews: context.app.reviews,
        contents: context.app.contents,
        runs: context.read.runs,
        workspace: context.workspace,
        installer: context.installer,
        baseline: context.baseline,
        appId: context.appId,
        appLogin: context.appLogin,
        gatesWorkflow: context.gatesWorkflow,
      },
      record,
    ),
  // The Reviewer reads with the job's read-only workflow token; its app token
  // only comments and completes the check run.
  reviewer: (context, record) =>
    reviewerBrief(
      {
        reviews: context.read.reviews,
        comments: context.read.comments,
        contents: context.read.contents,
        runs: context.read.runs,
        workspace: context.workspace,
        appId: context.appId,
        appLogin: context.appLogin,
        gatesWorkflow: context.gatesWorkflow,
      },
      record,
    ),
};

function owns(run: Run, role: Role, workflowRunId: number): boolean {
  return (
    roleOf(run.progress.state) === role &&
    run.workflowRun.id === workflowRunId &&
    run.workflowRun.role === role
  );
}

function outcomeOf(scope: EffectScope, ran: Session): Promise<RoleOutcome> {
  if (ran.timedOut) {
    return performFailure(scope, {
      failure: "time",
      message: "The stage ran out of the run's time.",
    });
  }
  if (ran.result.status === "ok")
    return performOutput(scope, ran.result.output);
  return performFailure(scope, ran.result);
}

// The session under a watch for `agent:stop` and a closed pull request, so a
// stop does not wait for GitHub to cancel the job (NFR-4.28d).
async function watchedSession(
  context: RoleJobContext,
  scope: EffectScope,
  role: Role,
): Promise<Session> {
  const { run, issue } = scope;
  const limits = runLimits(run, context.baseline);
  const watch = watchForStop({
    issues: context.read.issues,
    pulls: context.read.pulls,
    log: context.log,
    now: context.now,
    issue: issue.number,
    pr: run.pr,
    runId: run.id,
    workflowRunId: context.workflowRunId,
    ...context.stopWatch,
  });
  try {
    return await session(
      context,
      {
        role,
        issue: scope.issue,
        runId: run.id,
        planVersion: run.progress.planVersion,
        reviewRound: run.progress.reviewRound,
        pushes: run.pushes,
        config: run.config.text,
        maxTurns: limits.maxTurnsPerStage,
        brief: scope.brief,
      },
      {
        retries: limits.stageRetries,
        minutes: remainingMinutes(run, limits, context.now()),
        stop: watch.signal,
      },
    );
  } finally {
    await watch.end();
  }
}

async function work(
  context: RoleJobContext,
  record: RunRecord,
  role: Role,
): Promise<RoleJobOutput> {
  const { run } = record;
  const guard = guardFor(context, record.issue, run.id);
  await guard.ensure("role session", { state: run.progress.state });
  const issue = await context.read.issues.getIssue(record.issue);
  let brief: RoleBrief | undefined;
  try {
    brief = await BRIEFS[role](context, record);
  } catch (error) {
    if (!(error instanceof StageError)) throw error;
    return {
      status: "done",
      role,
      runId: run.id,
      attempts: 1,
      usage: NO_USAGE,
      outcome: error.outcome(),
    };
  }
  const scope: EffectScope = {
    context,
    guard,
    run,
    issue,
    appLogin: context.appLogin,
    brief,
    workspace: role === "developer" ? context.workspace : undefined,
    previousPr: record.previousRuns.findLast((earlier) => earlier.pr)?.pr,
  };
  const { pushedSha } = run.progress;
  if (role === "reviewer" && pushedSha !== undefined) {
    scope.checkRunId = await guard.perform("agent-review start", () =>
      context.app.checks.startCheckRun(AGENT_REVIEW, pushedSha),
    );
  }
  const ran = await watchedSession(context, scope, role);
  const outcome = await outcomeOf(scope, ran);
  return {
    status: "done",
    role,
    runId: run.id,
    attempts: ran.attempts,
    usage: ran.usage,
    outcome,
  };
}

// The job of a role: the session, then its side effects with the role's
// token. The job writes no state; the next job applies its output.
export async function runRoleJob(
  context: RoleJobContext,
  issue: number,
  role: Role,
): Promise<RoleJobOutput> {
  const record = (await context.store.read(issue))?.record;
  if (record === undefined || !owns(record.run, role, context.workflowRunId)) {
    return {
      status: "skipped",
      reason: `no ${role} stage of this workflow run`,
    };
  }
  try {
    return await work(context, record, role);
  } catch (error) {
    if (!(error instanceof RunInactiveError)) throw error;
    return { status: "skipped", reason: error.message };
  }
}
