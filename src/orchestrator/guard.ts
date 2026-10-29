import type { RunEventLog } from "../audit/run-events.ts";
import { STOP_LABEL } from "../config/schema.ts";
import type { Run } from "../core/run-store/run-record.ts";
import type { RunStateStore } from "../core/run-store/store.ts";
import { isActive, type RunStateName } from "../core/state-machine/states.ts";
import type { IssuesPort, PullRequestsPort } from "../github/ports.ts";

export interface GuardPorts {
  issues: Pick<IssuesPort, "getIssue">;
  pulls: Pick<PullRequestsPort, "getPull">;
  store: RunStateStore;
}

export interface GuardScope {
  issue: number;
  runId: string;
  workflowRunId: number;
  log: RunEventLog;
  now: () => Date;
}

export interface GuardOptions {
  // The state the run must still be in.
  state?: RunStateName;
  // The decide job checks before it takes the run over from an earlier
  // workflow run, so it does not require to own the run yet.
  takeover?: boolean;
}

export class RunInactiveError extends Error {
  constructor(effect: string, reason: string) {
    super(`Skipped ${effect}: ${reason}`);
    this.name = "RunInactiveError";
  }
}

// The check before every side effect of a run (FR-4.28c, SEC-9.8a). It reads
// the labels, the pull request and the stored state at the moment of the
// action, not from the event. Any one condition ends the run's side effects:
// a late state write cannot undo a stop, and removing the label does not
// resume it (FR-4.28).
export class RunGuard {
  private readonly ports: GuardPorts;
  private readonly scope: GuardScope;

  constructor(ports: GuardPorts, scope: GuardScope) {
    this.ports = ports;
    this.scope = scope;
  }

  async ensure(effect: string, options: GuardOptions = {}): Promise<void> {
    const reason = await this.inactiveReason(options);
    await this.scope.log.append({
      time: this.scope.now().toISOString(),
      type: "side-effect-check",
      issue: this.scope.issue,
      run: this.scope.runId,
      workflow_run: this.scope.workflowRunId,
      result: reason === undefined ? "active" : "inactive",
      details: { effect, ...(reason === undefined ? {} : { reason }) },
    });
    if (reason !== undefined) throw new RunInactiveError(effect, reason);
  }

  // The side effect after the check, logged with its start and end, so the
  // stop summary can name an operation that finished after the stop
  // (FR-4.28c, FR-4.28f).
  async perform<T>(
    effect: string,
    action: () => Promise<T>,
    options: GuardOptions = {},
  ): Promise<T> {
    await this.ensure(effect, options);
    const startedAt = this.scope.now().toISOString();
    const result = await action();
    const endedAt = this.scope.now().toISOString();
    await this.scope.log.append({
      time: endedAt,
      type: "side-effect",
      issue: this.scope.issue,
      run: this.scope.runId,
      workflow_run: this.scope.workflowRunId,
      started_at: startedAt,
      ended_at: endedAt,
      result: "done",
      details: { effect },
    });
    return result;
  }

  private async inactiveReason(
    options: GuardOptions,
  ): Promise<string | undefined> {
    const issue = await this.ports.issues.getIssue(this.scope.issue);
    if (issue.labels.includes(STOP_LABEL)) return `the issue has ${STOP_LABEL}`;
    const stored = await this.ports.store.read(this.scope.issue);
    const run = stored?.record.run;
    if (run?.id !== this.scope.runId) return "the store holds another run";
    return this.runReason(run, options) ?? (await this.pullReason(run.pr));
  }

  private runReason(run: Run, options: GuardOptions): string | undefined {
    const { state } = run.progress;
    if (!isActive(state)) return `the run is ${state}`;
    const owner = run.workflowRun.id;
    if (!options.takeover && owner !== this.scope.workflowRunId) {
      return `workflow run ${String(owner)} works on the run now`;
    }
    if (options.state !== undefined && state !== options.state) {
      return `the run is ${state}, not ${options.state}`;
    }
    return undefined;
  }

  private async pullReason(
    pr: number | undefined,
  ): Promise<string | undefined> {
    if (pr === undefined) return undefined;
    const pull = await this.ports.pulls.getPull(pr);
    if (pull.labels.includes(STOP_LABEL)) {
      return `the pull request has ${STOP_LABEL}`;
    }
    if (pull.state === "closed") return "the pull request is closed";
    return undefined;
  }
}
