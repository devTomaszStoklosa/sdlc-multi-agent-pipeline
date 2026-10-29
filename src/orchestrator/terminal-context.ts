import type { RunEventLog, RunEventRecord } from "../audit/run-events.ts";
import type { OrgBaseline } from "../config/schema.ts";
import type { RunRecord } from "../core/run-store/run-record.ts";
import type { RunStateStore } from "../core/run-store/store.ts";
import type { RunStateName } from "../core/state-machine/states.ts";
import type {
  CheckRunsPort,
  CommentsPort,
  IssuesPort,
  PullRequestsPort,
  WorkflowRunsPort,
} from "../github/ports.ts";
import type { TerminalTarget } from "./terminal-target.ts";

// What the jobs of stop.yml and pr-closed.yml share.

export interface TerminalLog {
  log: RunEventLog;
  now: () => Date;
  workflowRunId: number;
}

export interface TerminalEntry {
  type: string;
  run?: string;
  stage?: string;
  result?: string;
  round?: number;
  ended_at?: string;
  details?: Record<string, unknown>;
}

export async function logTerminal(
  context: TerminalLog,
  target: TerminalTarget,
  entry: TerminalEntry,
): Promise<void> {
  await context.log.append({
    time: context.now().toISOString(),
    issue: target.issue,
    pr: target.pr,
    workflow_run: context.workflowRunId,
    agent: "orchestrator",
    ...entry,
  });
}

export interface FinalizeContext extends TerminalLog {
  store: RunStateStore;
  app: {
    issues: Pick<IssuesPort, "removeLabel" | "lastLabeled">;
    comments: Pick<CommentsPort, "createComment">;
    checks: Pick<CheckRunsPort, "findInProgress" | "completeCheckRun">;
    pulls: Pick<PullRequestsPort, "getPull">;
  };
  runs: Pick<WorkflowRunsPort, "getRun" | "forceCancelRun">;
  baseline: OrgBaseline;
  // The run events of the cancelled workflow run, from its artifacts.
  events: readonly RunEventRecord[];
  wait: (ms: number) => Promise<void>;
}

export interface Ended {
  record: RunRecord;
  before: RunStateName;
  labeledAt: string;
  by: string;
}
