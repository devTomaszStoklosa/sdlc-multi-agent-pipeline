import type { GitHub } from "../github/client.ts";
import type { ApplyDeps } from "./apply.ts";
import { RunGuard } from "./guard.ts";

// What the orchestrator jobs share: the store and log of the run, the ports
// of the job's GitHub App token (`app`) and of its read-only workflow token
// (`read`), which the check of FR-4.28c uses.
export interface JobContext extends ApplyDeps {
  repository: string;
  app: GitHub;
  read: Pick<GitHub, "issues" | "pulls" | "runs">;
}

export function guardFor(
  context: JobContext,
  issue: number,
  runId: string,
): RunGuard {
  return new RunGuard(
    {
      issues: context.read.issues,
      pulls: context.read.pulls,
      store: context.store,
    },
    {
      issue,
      runId,
      workflowRunId: context.workflowRunId,
      log: context.log,
      now: context.now,
    },
  );
}
