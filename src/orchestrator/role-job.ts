import {
  roleResultSchema,
  type RoleInput,
  type RoleResult,
  type RoleRunner,
  type RoleUsage,
} from "../agents/role-runner.ts";
import type { Run } from "../core/run-store/run-record.ts";
import { roleOf } from "../core/state-machine/states.ts";
import type { Role } from "../hooks/roles.ts";
import { guardFor, type JobContext } from "./context.ts";
import { RunInactiveError } from "./guard.ts";
import { remainingMinutes, runLimits } from "./limits.ts";
import {
  AGENT_REVIEW,
  performFailure,
  performOutput,
  type EffectScope,
} from "./role-effects.ts";
import type { RoleJobOutput, RoleOutcome } from "./role-output.ts";
import { watchForStop, type Wait } from "./stop-watch.ts";

export interface RoleJobContext extends JobContext {
  runner: RoleRunner;
  stopWatch: { intervalMs: number; wait: Wait };
}

const RETRYABLE = new Set(["infra", "usage-limit"]);
const NO_USAGE: RoleUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  turns: 0,
};

function addUsage(total: RoleUsage, more: RoleUsage): RoleUsage {
  return {
    input_tokens: total.input_tokens + more.input_tokens,
    output_tokens: total.output_tokens + more.output_tokens,
    cost_usd: total.cost_usd + more.cost_usd,
    turns: total.turns + more.turns,
  };
}

type Session =
  | { timedOut: false; result: RoleResult; attempts: number; usage: RoleUsage }
  | { timedOut: true; attempts: number; usage: RoleUsage };

async function attempt(
  runner: RoleRunner,
  input: RoleInput,
  signal: AbortSignal,
): Promise<RoleResult | "timed-out"> {
  try {
    const parsed = roleResultSchema.safeParse(await runner.run(input, signal));
    if (parsed.success) return parsed.data;
    return {
      status: "failed",
      failure: "infra",
      message: "Invalid session result",
      usage: NO_USAGE,
    };
  } catch (error) {
    // A stop ends the job without side effects; the time limit escalates.
    if (signal.reason instanceof RunInactiveError) throw signal.reason;
    if (signal.aborted) return "timed-out";
    const message = error instanceof Error ? error.message : String(error);
    return { status: "failed", failure: "infra", message, usage: NO_USAGE };
  }
}

interface SessionLimits {
  retries: number;
  minutes: number;
  stop: AbortSignal;
}

// One stage: the session and its retries after infrastructure errors, within
// the run's remaining time (FR-4.30, NFR-11.5), until a stop.
async function session(
  context: RoleJobContext,
  input: Omit<RoleInput, "attempt">,
  limits: SessionLimits,
): Promise<Session> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(Math.max(1, limits.minutes * 60_000)),
    limits.stop,
  ]);
  let usage = NO_USAGE;
  for (let attempts = 1; ; attempts++) {
    const result = await attempt(
      context.runner,
      { ...input, attempt: attempts },
      signal,
    );
    if (result === "timed-out") return { timedOut: true, attempts, usage };
    usage = addUsage(usage, result.usage);
    await context.log.append({
      time: context.now().toISOString(),
      type: "stage-attempt",
      issue: input.issue.number,
      run: input.runId,
      agent: input.role,
      workflow_run: context.workflowRunId,
      result: result.status === "ok" ? "ok" : result.failure,
      round: input.reviewRound,
      tokens: {
        input: result.usage.input_tokens,
        output: result.usage.output_tokens,
      },
      cost_usd: result.usage.cost_usd,
      details: { attempt: attempts },
    });
    const retry = result.status === "failed" && RETRYABLE.has(result.failure);
    if (!retry || attempts > limits.retries)
      return { timedOut: false, result, attempts, usage };
  }
}

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
        findings: run.progress.findings,
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
  issueNumber: number,
  { run, role }: { run: Run; role: Role },
): Promise<RoleJobOutput> {
  const guard = guardFor(context, issueNumber, run.id);
  await guard.ensure("role session", { state: run.progress.state });
  const issue = await context.read.issues.getIssue(issueNumber);
  const scope: EffectScope = { context, guard, run, issue };
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
  const run = (await context.store.read(issue))?.record.run;
  if (run === undefined || !owns(run, role, context.workflowRunId)) {
    return {
      status: "skipped",
      reason: `no ${role} stage of this workflow run`,
    };
  }
  try {
    return await work(context, issue, { run, role });
  } catch (error) {
    if (!(error instanceof RunInactiveError)) throw error;
    return { status: "skipped", reason: error.message };
  }
}
