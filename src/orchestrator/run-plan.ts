import { planEntries, planOf } from "../agents/planner/plan-comment.ts";
import type { Run } from "../core/run-store/run-record.ts";
import type { CommentsPort } from "../github/ports.ts";

export interface RunPlan {
  version: number;
  body: string;
  url: string;
}

// The plan version a run works on: the approved one for a high-impact change
// and the latest otherwise, because a version that needs approval stops the
// run until it has one (FR-4.6, FR-4.11).
export async function runPlan(
  sources: { comments: CommentsPort; appId: number },
  issue: number,
  run: Run,
): Promise<RunPlan> {
  const entries = planEntries(
    await sources.comments.listComments(issue),
    sources.appId,
  );
  const plan = planOf(entries, run.id, run.progress.planVersion);
  if (plan === undefined) {
    throw new Error(
      `Plan version ${String(run.progress.planVersion)} of run ${run.id} is missing.`,
    );
  }
  return { version: plan.block.version, body: plan.body, url: plan.url };
}
