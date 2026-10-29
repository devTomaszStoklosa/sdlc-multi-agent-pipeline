import { STOP_LABEL } from "../config/schema.ts";
import {
  withProgress,
  type Run,
  type RunRecord,
} from "../core/run-store/run-record.ts";
import type { RunStateStore } from "../core/run-store/store.ts";
import type { RunEvent } from "../core/state-machine/events.ts";
import { transition } from "../core/state-machine/machine.ts";
import { isActive } from "../core/state-machine/states.ts";
import type { WorkflowRunsPort } from "../github/ports.ts";
import { finishedAfter, waitUntilCompleted } from "./terminal-runs.ts";
import { mismatch, type TerminalTarget } from "./terminal-target.ts";
import { cleanUp } from "./terminal-cleanup.ts";
import {
  logTerminal,
  type Ended,
  type FinalizeContext,
  type TerminalLog,
} from "./terminal-context.ts";

export interface CancelContext extends TerminalLog {
  store: RunStateStore;
  runs: Pick<WorkflowRunsPort, "getRun" | "cancelRun">;
}

function activeRun(
  record: RunRecord | undefined,
  target: TerminalTarget,
): { run: Run } | { reason: string } {
  const reason = mismatch(record, target);
  if (reason !== undefined || record === undefined)
    return { reason: reason ?? "" };
  const { state } = record.run.progress;
  if (!isActive(state)) return { reason: `the run is already ${state}` };
  return { run: record.run };
}

// The first job of stop.yml and pr-closed.yml, outside any concurrency group
// and with the only token that may cancel runs (plan 2.2, spec 5). It cancels
// the workflow run that works on the run, so the stop does not wait for the
// end of a role job.
export async function cancelActiveRun(
  context: CancelContext,
  target: TerminalTarget,
): Promise<number | undefined> {
  const found = activeRun(
    (await context.store.read(target.issue))?.record,
    target,
  );
  if ("reason" in found) {
    await logTerminal(context, target, {
      type: `${target.kind}-ignored`,
      result: found.reason,
    });
    return undefined;
  }
  const id = found.run.workflowRun.id;
  const owner = await context.runs.getRun(id);
  if (owner.status === "completed") return undefined;
  await context.runs.cancelRun(id);
  await logTerminal(context, target, {
    type: "cancel",
    run: found.run.id,
    result: "requested",
    details: { cancelled_workflow_run: id },
  });
  return id;
}

const WRITE_ATTEMPTS = 3;

function terminalEvent(target: TerminalTarget): RunEvent {
  return target.kind === "stop"
    ? { type: "stop-requested" }
    : { type: "pr-closed", merged: target.merged === true };
}

interface StopFacts {
  by: string;
  labeledAt: string;
}

// Who added agent:stop and when, from the label events of the issue or pull
// request (FR-4.28f, NFR-4.28d).
async function stopFacts(
  context: FinalizeContext,
  target: TerminalTarget,
): Promise<StopFacts> {
  const now = context.now().toISOString();
  if (target.kind !== "stop") return { by: target.actor, labeledAt: now };
  const labeled = await context.app.issues.lastLabeled(
    target.pr ?? target.issue,
    STOP_LABEL,
  );
  return { by: labeled?.actor ?? target.actor, labeledAt: labeled?.at ?? now };
}

function endedRun(
  run: Run,
  target: TerminalTarget,
  { facts, now }: { facts: StopFacts; now: Date },
): Run | undefined {
  const result = transition(run.progress, terminalEvent(target), {
    maxReviewRounds: 0,
  });
  if (!result.applied) return undefined;
  const stop =
    target.kind === "stop" ? { ...facts, where: target.where } : undefined;
  const state = target.kind === "stop" ? "stopped" : "done";
  return {
    ...withProgress(run, result.progress, now),
    stop,
    end: { state, at: now.toISOString(), merged: target.merged },
  };
}

// The final state, which the first terminal write sets: a run that is already
// stopped or done only gets a log entry (FR-4.28, FR-4.35, plan 9).
async function endRun(
  context: FinalizeContext,
  target: TerminalTarget,
): Promise<Ended | undefined> {
  const facts = await stopFacts(context, target);
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    const stored = await context.store.read(target.issue);
    const found = activeRun(stored?.record, target);
    if ("reason" in found || stored === undefined) {
      const result = "reason" in found ? found.reason : "";
      await logTerminal(context, target, {
        type: `${target.kind}-ignored`,
        result,
      });
      return undefined;
    }
    const ended = endedRun(found.run, target, { facts, now: context.now() });
    if (ended === undefined) return undefined;
    const { record } = stored;
    const written = await context.store.write(
      { ...record, run: ended },
      record.revision,
    );
    if (written.ok) {
      const before = found.run.progress.state;
      return { record: written.stored.record, before, ...facts };
    }
  }
  throw new Error(
    `The run state of issue #${String(target.issue)} kept changing.`,
  );
}

// The second job: it waits for the cancelled workflow run, writes the final
// state, then cleans up without the check of FR-4.28c, which does not cover
// the stop's own actions (FR-4.28a, FR-4.28f, FR-4.35).
export async function finalize(
  context: FinalizeContext,
  target: TerminalTarget,
  cancelled: number | undefined,
): Promise<void> {
  const completedAt =
    cancelled === undefined
      ? undefined
      : await waitUntilCompleted(context, cancelled);
  const ended = await endRun(context, target);
  if (ended === undefined) return;
  const finished = finishedAfter(context.events, ended.labeledAt);
  await cleanUp(context, target, { ended, cancelled, completedAt, finished });
}
