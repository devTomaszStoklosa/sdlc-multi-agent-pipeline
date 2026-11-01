import type { Run } from "../core/run-store/run-record.ts";
import type { RunEvent } from "../core/state-machine/events.ts";
import {
  applyChange,
  performEscalations,
  type Applied,
  type Change,
} from "./apply.ts";
import { guardFor, type JobContext } from "./context.ts";
import type { DecideResult } from "./decide.ts";
import { RunInactiveError } from "./guard.ts";
import { requestHumanReview } from "./review-request.ts";
import type { RoleJobOutput, RoleOutcome } from "./role-output.ts";

type Done = Extract<RoleJobOutput, { status: "done" }>;

function eventOf(outcome: RoleOutcome): RunEvent {
  switch (outcome.kind) {
    case "plan":
      return {
        type: "plan-published",
        version: outcome.version,
        highImpact: outcome.highImpact,
      };
    case "plan-update":
      return {
        type: "plan-updated",
        version: outcome.version,
        highImpact: outcome.highImpact,
      };
    case "pushed":
      return {
        type: "pushed",
        sha: outcome.sha,
        planVersion: outcome.planVersion,
      };
    case "verdict":
      return {
        type: "verdict",
        verdict: outcome.verdict,
        blockingFindings: outcome.blockingFindings,
      };
    case "failed":
      if (outcome.failure === "time")
        return { type: "limit-reached", limit: "time" };
      if (outcome.failure === "max-turns")
        return { type: "limit-reached", limit: "turns" };
      return {
        type: "stage-failed",
        failure: outcome.failure,
        resetsAt: outcome.resetsAt,
      };
  }
}

// The run's own fields that a stage changes: its usage (NFR-11.4) and, after
// a push, its branch and pull request.
function updateOf(done: Done): (run: Run) => Run {
  return (run) => {
    const usage = [
      ...run.usage,
      {
        role: done.role,
        round: run.progress.reviewRound,
        attempts: done.attempts,
        inputTokens: done.usage.input_tokens,
        outputTokens: done.usage.output_tokens,
        costUsd: done.usage.cost_usd,
        turns: done.usage.turns,
      },
    ];
    const { outcome } = done;
    if (outcome.kind !== "pushed") return { ...run, usage };
    return {
      ...run,
      usage,
      branch: outcome.branch,
      pr: outcome.pr,
      pushes: run.pushes + 1,
    };
  };
}

function changeOf(output: RoleJobOutput | undefined): Change | undefined {
  // A role job that failed without an output is an infrastructure error.
  if (output === undefined)
    return { event: { type: "stage-failed", failure: "infra" } };
  if (output.status === "skipped") return undefined;
  return { event: eventOf(output.outcome), update: updateOf(output) };
}

// The pipeline's app and its bot, the authors of the plans and reviews that
// the final review request reads.
export interface AdvanceContext extends JobContext {
  appId: number;
  appLogin: string;
}

function reviewOf(output: RoleJobOutput | undefined) {
  if (output?.status !== "done" || output.outcome.kind !== "verdict") {
    return undefined;
  }
  return output.outcome.review;
}

// The side effects that a transition asks for, after the state is written.
async function performActions(
  context: AdvanceContext,
  applied: Applied,
  output: RoleJobOutput | undefined,
): Promise<void> {
  const guard = guardFor(context, applied.record.issue, applied.record.run.id);
  await performEscalations(applied, context.app, guard, reviewOf(output));
  if (!applied.actions.some((action) => action.type === "request-review")) {
    return;
  }
  const { app, appId, appLogin } = context;
  await requestHumanReview({ ...app, appId, appLogin }, guard, applied.record);
}

// The job after a role job: it applies the role's output to the run and
// chooses the next role, without a model and without the Claude token.
export async function advance(
  context: AdvanceContext,
  issue: number,
  output: RoleJobOutput | undefined,
): Promise<DecideResult> {
  const change = changeOf(output);
  const run = (await context.store.read(issue))?.record.run;
  if (change === undefined || run === undefined) return {};
  try {
    await guardFor(context, issue, run.id).ensure("state write");
    const applied = await applyChange(context, issue, change);
    if (applied === undefined) return {};
    await performActions(context, applied, output);
    return { role: applied.role, runId: run.id };
  } catch (error) {
    if (!(error instanceof RunInactiveError)) throw error;
    await context.log.append({
      time: context.now().toISOString(),
      type: "ignored",
      issue,
      run: run.id,
      workflow_run: context.workflowRunId,
      result: error.message,
    });
    return {};
  }
}
