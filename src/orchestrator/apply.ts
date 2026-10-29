import type { RunEventLog } from "../audit/run-events.ts";
import type { OrgBaseline } from "../config/schema.ts";
import {
  withProgress,
  type Run,
  type RunRecord,
} from "../core/run-store/run-record.ts";
import type { RunStateStore } from "../core/run-store/store.ts";
import type { RunAction, RunEvent } from "../core/state-machine/events.ts";
import { transition } from "../core/state-machine/machine.ts";
import { isActive } from "../core/state-machine/states.ts";
import type { CommentsPort, IssuesPort } from "../github/ports.ts";
import type { Role } from "../hooks/roles.ts";
import type { RunGuard } from "./guard.ts";
import { reachedLimit, runLimits } from "./limits.ts";
import { escalation } from "./messages.ts";

const WRITE_ATTEMPTS = 3;

export interface ApplyDeps {
  store: RunStateStore;
  log: RunEventLog;
  baseline: OrgBaseline;
  now: () => Date;
  workflowRunId: number;
}

export interface Applied {
  record: RunRecord;
  actions: RunAction[];
  role: Role | undefined;
}

export interface Change {
  event: RunEvent;
  // Changes of the run's own fields, such as its usage, made with the event.
  update?: (run: Run) => Run;
}

function roleToStart(actions: readonly RunAction[]): Role | undefined {
  return actions.find((action) => action.type === "start-role")?.role;
}

type Computed =
  | { applied: true; run: Run; actions: RunAction[]; rule: string }
  | { applied: false; reason: string };

// A role starts only within the run's limits; otherwise the run escalates
// (FR-4.31, NFR-11.5).
function compute(record: RunRecord, change: Change, deps: ApplyDeps): Computed {
  const limits = runLimits(record.run, deps.baseline);
  const now = deps.now();
  const base = change.update ? change.update(record.run) : record.run;
  const result = transition(base.progress, change.event, limits);
  if (!result.applied) return result;
  let run = withProgress(base, result.progress, now);
  let { actions, rule } = result;
  const limit = roleToStart(actions) && reachedLimit(run, limits, now);
  if (limit) {
    const escalated = transition(
      run.progress,
      { type: "limit-reached", limit },
      limits,
    );
    if (escalated.applied) {
      run = withProgress(run, escalated.progress, now);
      ({ actions, rule } = escalated);
    }
  }
  const workflowRun = { id: deps.workflowRunId, role: roleToStart(actions) };
  return { applied: true, run: { ...run, workflowRun }, actions, rule };
}

// Applies an event to the active run of an issue and stores the result. A
// write that loses against another writer reads the new state and decides
// again, so the decision always rests on the latest state (plan 9).
export async function applyChange(
  deps: ApplyDeps,
  issue: number,
  change: Change,
): Promise<Applied | undefined> {
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    const stored = await deps.store.read(issue);
    if (stored === undefined || !isActive(stored.record.run.progress.state)) {
      return undefined;
    }
    const { record } = stored;
    const computed = compute(record, change, deps);
    if (!computed.applied) {
      await logEvent(deps, record, {
        type: "ignored",
        result: computed.reason,
        event: change.event,
      });
      return undefined;
    }
    const written = await deps.store.write(
      { ...record, run: computed.run },
      record.revision,
    );
    if (written.ok) {
      const next = written.stored.record;
      await logEvent(deps, next, {
        type: "transition",
        result: computed.rule,
        event: change.event,
      });
      return {
        record: next,
        actions: computed.actions,
        role: roleToStart(computed.actions),
      };
    }
  }
  throw new Error(`The run state of issue #${String(issue)} kept changing.`);
}

interface LogEntry {
  type: string;
  result: string;
  event: RunEvent;
}

async function logEvent(
  deps: ApplyDeps,
  record: RunRecord,
  { type, result, event }: LogEntry,
): Promise<void> {
  await deps.log.append({
    time: deps.now().toISOString(),
    type,
    issue: record.issue,
    run: record.run.id,
    pr: record.run.pr,
    stage: record.run.progress.state,
    agent: "orchestrator",
    workflow_run: deps.workflowRunId,
    result,
    round: record.run.progress.reviewRound,
    details: { event: event.type },
  });
}

export interface EscalationPorts {
  issues: Pick<IssuesPort, "addLabels">;
  comments: Pick<CommentsPort, "createComment">;
}

// The escalation of a transition: the needs-human label and a comment that
// says why and how to resume (FR-4.18, FR-4.30, FR-4.31).
export async function performEscalations(
  applied: Applied,
  ports: EscalationPorts,
  guard: RunGuard,
): Promise<void> {
  const { run, issue } = applied.record;
  for (const action of applied.actions) {
    if (action.type !== "escalate") continue;
    await guard.ensure("escalation label");
    await ports.issues.addLabels(issue, [run.labels.needs_human]);
    await guard.ensure("escalation comment");
    await ports.comments.createComment(issue, escalation(run, action.reason));
  }
}
