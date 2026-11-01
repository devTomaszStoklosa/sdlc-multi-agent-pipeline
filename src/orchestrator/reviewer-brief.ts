import type { ReviewerBrief } from "../agents/reviewer/brief.ts";
import type { GateResults } from "../agents/reviewer/review-comment.ts";
import type { RunRecord } from "../core/run-store/run-record.ts";
import type { RunWorkspace } from "../git/workspace.ts";
import type { ContentsPort, WorkflowRunsPort } from "../github/ports.ts";
import { openReview, type ReviewSources } from "./review-history.ts";
import { runPlan } from "./run-plan.ts";

// What the Reviewer's job reads with its read-only workflow token.
export interface ReviewerSources extends ReviewSources {
  contents: ContentsPort;
  runs: WorkflowRunsPort;
  workspace: RunWorkspace;
  // The name of the repository's gates workflow (plan 3.5).
  gatesWorkflow: string;
}

// The jobs of the gates that passed on the reviewed commit (FR-5.3).
async function gateResults(
  sources: ReviewerSources,
  sha: string,
): Promise<GateResults> {
  const gates = await sources.runs.findRunForSha(sources.gatesWorkflow, sha);
  if (gates === undefined) return { jobs: [] };
  const jobs = await sources.runs.listJobs(gates.id);
  return {
    url: gates.url,
    jobs: jobs.map((job) => ({
      name: job.name,
      conclusion: job.conclusion ?? "unknown",
    })),
  };
}

// What a Reviewer session gets besides the issue: the plan, the whole diff of
// the pull request against the main branch, the gate results and the open
// findings of the previous round with the Developer's replies, and the
// workspace on the reviewed commit (FR-4.13, FR-4.16, FR-5.3). The
// Developer's summary and commit messages stay out.
export async function reviewerBrief(
  sources: ReviewerSources,
  record: RunRecord,
): Promise<ReviewerBrief> {
  const { run } = record;
  const sha = run.progress.pushedSha;
  if (sha === undefined || run.pr === undefined) {
    throw new Error(`Run ${run.id} has no pushed pull request to review.`);
  }
  const plan = await runPlan(sources, record.issue, run);
  await sources.workspace.prepare({ branch: run.branch, at: sha });
  const main = await sources.contents.defaultBranch();
  return {
    kind: "reviewer",
    plan,
    sha,
    diff: await sources.contents.compare(main.name, sha),
    gates: await gateResults(sources, sha),
    earlier: (await openReview(sources, run))?.findings ?? [],
  };
}
