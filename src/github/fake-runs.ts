import type {
  WorkflowJobInfo,
  WorkflowRunInfo,
  WorkflowRunsPort,
} from "./ports.ts";

export interface FakeRun extends WorkflowRunInfo {
  name?: string;
  headSha?: string;
}

// The workflow runs of the GitHub in memory, with their jobs and logs.
export class FakeWorkflowRuns implements WorkflowRunsPort {
  readonly runs = new Map<number, FakeRun>();
  readonly jobs = new Map<number, (WorkflowJobInfo & { log: string })[]>();
  // A hook that tests use to change GitHub when a run is cancelled.
  onCancel: (id: number) => void = (id) => {
    this.completeRun(id, "cancelled");
  };

  addRun(id: number, fields: Partial<FakeRun> = {}): void {
    this.runs.set(id, {
      id,
      status: "in_progress",
      conclusion: null,
      ...fields,
    });
  }

  completeRun(id: number, conclusion: string): void {
    const run = this.runs.get(id);
    if (run) Object.assign(run, { status: "completed", conclusion });
  }

  getRun(id: number): Promise<WorkflowRunInfo> {
    const run = this.runs.get(id);
    if (run === undefined) throw new Error(`No workflow run ${String(id)}`);
    return Promise.resolve({ ...run });
  }

  listJobs(runId: number): Promise<WorkflowJobInfo[]> {
    const jobs = this.jobs.get(runId) ?? [];
    return Promise.resolve(
      jobs.map(({ id, name, conclusion }) => ({ id, name, conclusion })),
    );
  }

  jobLog(jobId: number): Promise<string> {
    const job = [...this.jobs.values()]
      .flat()
      .find((entry) => entry.id === jobId);
    if (job === undefined) throw new Error(`No job ${String(jobId)}`);
    return Promise.resolve(job.log);
  }

  cancelRun(id: number): Promise<void> {
    this.onCancel(id);
    return Promise.resolve();
  }

  forceCancelRun(id: number): Promise<void> {
    this.completeRun(id, "cancelled");
    return Promise.resolve();
  }

  findRunForSha(
    workflowName: string,
    sha: string,
  ): Promise<WorkflowRunInfo | undefined> {
    const run = [...this.runs.values()].findLast(
      (candidate) =>
        candidate.name === workflowName && candidate.headSha === sha,
    );
    return Promise.resolve(run && { ...run });
  }
}
