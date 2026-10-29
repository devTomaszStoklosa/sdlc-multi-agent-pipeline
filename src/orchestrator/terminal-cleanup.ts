import { workingMinutes } from "../core/state-machine/working-time.ts";
import { isWorking } from "../core/state-machine/states.ts";
import { costUsd, runLimits, type RunLimits } from "./limits.ts";
import { AGENT_REVIEW } from "./role-effects.ts";
import { stopSummary } from "./stop-summary.ts";
import {
  logTerminal,
  type Ended,
  type FinalizeContext,
} from "./terminal-context.ts";
import type { TerminalTarget } from "./terminal-target.ts";

export interface CleanupFacts {
  ended: Ended;
  cancelled: number | undefined;
  completedAt: string | undefined;
  finished: string[];
}

function limitsOf(
  context: FinalizeContext,
  ended: Ended,
): RunLimits | undefined {
  try {
    return runLimits(ended.record.run, context.baseline);
  } catch {
    return undefined;
  }
}

// The in-progress `agent-review` check runs of the run's last push and of the
// pull request's head.
async function reviewChecks(
  context: FinalizeContext,
  ended: Ended,
): Promise<number[]> {
  const { run } = ended.record;
  const pull =
    run.pr === undefined ? undefined : await context.app.pulls.getPull(run.pr);
  const shas = new Set([run.progress.pushedSha, pull?.headSha]);
  const ids = await Promise.all(
    [...shas].flatMap((sha) =>
      sha === undefined
        ? []
        : [context.app.checks.findInProgress(AGENT_REVIEW, sha)],
    ),
  );
  return [...new Set(ids.flat())];
}

async function publishSummary(
  context: FinalizeContext,
  target: TerminalTarget,
  facts: CleanupFacts,
  checks: number,
): Promise<string | undefined> {
  const { ended } = facts;
  const { run } = ended.record;
  const pull =
    run.pr === undefined ? undefined : await context.app.pulls.getPull(run.pr);
  const body = stopSummary({
    run,
    state: ended.before,
    by: ended.by,
    where: target.where,
    labeledAt: ended.labeledAt,
    pullUrl: pull?.url,
    cancelledRole:
      facts.cancelled !== undefined && isWorking(ended.before)
        ? run.workflowRun.role
        : undefined,
    finishedAfterStop: facts.finished,
    cancelledChecks: checks,
    usedMinutes: workingMinutes(run.history, context.now()),
    usedCostUsd: costUsd(run),
    limits: limitsOf(context, ended),
  });
  // A failed summary does not undo the stop and goes to the log (FR-4.28f).
  try {
    return (await context.app.comments.createComment(target.issue, body)).url;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logTerminal(context, target, {
      type: "summary-failed",
      run: run.id,
      result: reason,
    });
    return undefined;
  }
}

// The clean-up of a stopped or done run: the ready and plan-approved labels
// under the names of the run's configuration copy (FR-4.28a, FR-4.35,
// FR-10.4), the summary of a stop (FR-4.28f) and the in-progress
// `agent-review` check run, cancelled with a link to the summary.
export async function cleanUp(
  context: FinalizeContext,
  target: TerminalTarget,
  facts: CleanupFacts,
): Promise<void> {
  const { run } = facts.ended.record;
  const removed: string[] = [];
  for (const label of [run.labels.ready, run.labels.plan_approved]) {
    if (await context.app.issues.removeLabel(target.issue, label))
      removed.push(label);
  }
  const checks = await reviewChecks(context, facts.ended);
  const summaryUrl =
    target.kind === "stop"
      ? await publishSummary(context, target, facts, checks.length)
      : undefined;
  for (const id of checks) {
    await context.app.checks.completeCheckRun(id, "cancelled", {
      title:
        target.kind === "stop" ? "Przebieg zatrzymany" : "Przebieg zakończony",
      summary: summaryUrl ?? `Przebieg ${run.id} zakończony po zamknięciu PR.`,
      detailsUrl: summaryUrl,
    });
  }
  await logTerminal(context, target, {
    type: target.kind,
    run: run.id,
    stage: facts.ended.before,
    result: run.progress.state,
    round: run.progress.reviewRound,
    ended_at: facts.completedAt,
    details: {
      by: facts.ended.by,
      where: target.where,
      labeled_at: facts.ended.labeledAt,
      detection: "event",
      merged: target.merged,
      cancelled_workflow_run: facts.cancelled,
      finished_after_stop: facts.finished,
      labels_removed: removed,
      checks_cancelled: checks.length,
      summary_url: summaryUrl,
    },
  });
}
