import type { RunEventLog } from "../audit/run-events.ts";
import { STOP_LABEL } from "../config/schema.ts";
import type { IssuesPort, PullRequestsPort } from "../github/ports.ts";
import { RunInactiveError } from "./guard.ts";

// How often a role job looks for a stop while its session runs. GitHub takes
// about a minute to deliver a cancellation to a running step, so the job does
// not wait for it (NFR-4.28d). Two reads per check stay within the hourly
// limit of the workflow token.
export const STOP_WATCH_MS = 15_000;

export type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

export interface StopWatchScope {
  issues: Pick<IssuesPort, "getIssue">;
  pulls: Pick<PullRequestsPort, "getPull">;
  log: RunEventLog;
  now: () => Date;
  issue: number;
  pr: number | undefined;
  runId: string;
  workflowRunId: number;
  intervalMs: number;
  wait: Wait;
}

async function stopReason(scope: StopWatchScope): Promise<string | undefined> {
  const issue = await scope.issues.getIssue(scope.issue);
  if (issue.labels.includes(STOP_LABEL)) return `the issue has ${STOP_LABEL}`;
  if (scope.pr === undefined) return undefined;
  const pull = await scope.pulls.getPull(scope.pr);
  if (pull.labels.includes(STOP_LABEL))
    return `the pull request has ${STOP_LABEL}`;
  if (pull.state === "closed") return "the pull request is closed";
  return undefined;
}

export interface StopWatch {
  // Aborted with a RunInactiveError when the watch sees a stop.
  signal: AbortSignal;
  end(): Promise<void>;
}

// Watches the labels of the issue and of the run's pull request while a
// session runs, and aborts the session on `agent:stop` or a closed pull
// request (FR-4.28, FR-4.35). A failed check does not abort it: the session
// goes on, and the check before every side effect still applies (FR-4.28c).
export function watchForStop(scope: StopWatchScope): StopWatch {
  const session = new AbortController();
  const ended = new AbortController();
  const isEnded = () => ended.signal.aborted;
  const loop = (async () => {
    while (!isEnded()) {
      try {
        await scope.wait(scope.intervalMs, ended.signal);
      } catch {
        return;
      }
      const reason = await stopReason(scope).catch(() => undefined);
      if (reason === undefined || isEnded()) continue;
      await scope.log.append({
        time: scope.now().toISOString(),
        type: "stop-detected",
        issue: scope.issue,
        run: scope.runId,
        workflow_run: scope.workflowRunId,
        result: reason,
      });
      session.abort(new RunInactiveError("session", reason));
      return;
    }
  })();
  return {
    signal: session.signal,
    end: async () => {
      ended.abort();
      await loop;
    },
  };
}
