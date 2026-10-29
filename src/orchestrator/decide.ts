import type { RunRecord } from "../core/run-store/run-record.ts";
import type { RunEvent } from "../core/state-machine/events.ts";
import { isWorking, roleOf } from "../core/state-machine/states.ts";
import { authorize, type Actor } from "../github/authorize.ts";
import type { Role } from "../hooks/roles.ts";
import { applyChange, performEscalations, type Applied } from "./apply.ts";
import { guardFor, type JobContext } from "./context.ts";
import type { GitHubEvent } from "./filter.ts";
import { RunInactiveError } from "./guard.ts";
import { admit, startRun } from "./start-run.ts";
import { triggerOf, type Trigger } from "./triggers.ts";

export interface DecideContext extends JobContext {
  // The name of the repository's gates workflow (plan 3.5).
  gatesWorkflow: string;
}

export interface DecideResult {
  role?: Role;
  runId?: string;
}

async function logIgnored(context: JobContext, issue: number, reason: string) {
  await context.log.append({
    time: context.now().toISOString(),
    type: "ignored",
    issue,
    agent: "orchestrator",
    workflow_run: context.workflowRunId,
    result: reason,
  });
}

// The event that a manual dispatch recovers, for events that did not arrive
// or a job that ended without a result (plan 8, FR-4.36).
async function recoveredEvent(
  context: DecideContext,
  record: RunRecord,
): Promise<RunEvent | undefined> {
  const { progress, workflowRun } = record.run;
  if (progress.state === "gating" && progress.pushedSha !== undefined) {
    const gates = await context.read.runs.findRunForSha(
      context.gatesWorkflow,
      progress.pushedSha,
    );
    if (gates?.status !== "completed" || gates.conclusion === null)
      return undefined;
    if (["cancelled", "skipped"].includes(gates.conclusion)) return undefined;
    const passed = gates.conclusion === "success";
    return { type: "gates-completed", sha: progress.pushedSha, passed };
  }
  if (!isWorking(progress.state) || roleOf(progress.state) === undefined) {
    return undefined;
  }
  const owner = await context.read.runs.getRun(workflowRun.id);
  if (owner.status !== "completed") return undefined;
  return { type: "stage-failed", failure: "infra" };
}

async function reconcile(
  context: DecideContext,
  record: RunRecord | undefined,
  actor: Actor,
): Promise<Applied | undefined> {
  if (!(await authorize(actor, "dispatch", context.app.permissions)).allowed) {
    return undefined;
  }
  if (record === undefined) return undefined;
  if (record.run.progress.state === "queued")
    return admit(context, record, false);
  const event = await recoveredEvent(context, record);
  return event && applyEvent(context, record, { kind: "event", event });
}

async function applyEvent(
  context: DecideContext,
  record: RunRecord,
  trigger: Extract<Trigger, { kind: "event" }>,
): Promise<Applied | undefined> {
  await guardFor(context, record.issue, record.run.id).ensure("state write", {
    takeover: true,
  });
  return applyChange(context, record.issue, trigger);
}

async function handle(
  context: DecideContext,
  issue: number,
  event: GitHubEvent,
): Promise<Applied | undefined> {
  const record = (await context.store.read(issue))?.record;
  const trigger = await triggerOf(
    event,
    record,
    context.app.permissions,
    context.now(),
  );
  switch (trigger.kind) {
    case "ignore":
      await logIgnored(context, issue, trigger.reason);
      return undefined;
    case "start":
      return startRun(context, issue, trigger);
    case "reconcile":
      return reconcile(context, record, trigger.actor);
    case "event":
      return record && applyEvent(context, record, trigger);
  }
}

// The decide job: what an event means for the run, the new state and the
// role to start, without a model and without the Claude token (plan 3.5).
export async function decide(
  context: DecideContext,
  issue: number,
  event: GitHubEvent,
): Promise<DecideResult> {
  try {
    const applied = await handle(context, issue, event);
    if (applied === undefined) return {};
    const guard = guardFor(context, issue, applied.record.run.id);
    await performEscalations(applied, context.app, guard);
    return { role: applied.role, runId: applied.record.run.id };
  } catch (error) {
    if (!(error instanceof RunInactiveError)) throw error;
    await logIgnored(context, issue, error.message);
    return {};
  }
}
