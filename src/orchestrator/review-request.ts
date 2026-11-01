import type { RunRecord } from "../core/run-store/run-record.ts";
import type { IssuesPort, PullRequestsPort } from "../github/ports.ts";
import type { RunGuard } from "./guard.ts";
import { reviewsOfRun, type ReviewSources } from "./review-history.ts";
import { reviewSummary, withReviewSummary } from "./review-summary.ts";
import { runPlan } from "./run-plan.ts";

export interface ReviewRequestSources extends ReviewSources {
  issues: Pick<IssuesPort, "getIssue">;
  pulls: PullRequestsPort;
}

// People assigned to the issue; an app cannot review.
function reviewers(assignees: readonly string[]): string[] {
  return assignees.filter((login) => !login.endsWith("[bot]"));
}

// After `approve`: the pull request body per FR-4.20, the end of the draft,
// and the request for the final review as the last step before a merge
// (FR-6.4). The issue's assignees are asked; without them, GitHub asks the
// code owners when the draft ends. Each step after the check of FR-4.28c.
export async function requestHumanReview(
  sources: ReviewRequestSources,
  guard: RunGuard,
  record: RunRecord,
): Promise<void> {
  const { run } = record;
  const pr = run.pr;
  if (pr === undefined) return;
  const plan = await runPlan(sources, record.issue, run);
  const summary = reviewSummary(plan, await reviewsOfRun(sources, run));
  const { body } = await sources.pulls.getPull(pr);
  await guard.perform("pull request body", () =>
    sources.pulls.updatePullBody(pr, withReviewSummary(body, summary)),
  );
  await guard.perform("ready for review", () =>
    sources.pulls.markReadyForReview(pr),
  );
  const issue = await sources.issues.getIssue(record.issue);
  const logins = reviewers(issue.assignees);
  if (logins.length === 0) return;
  await guard.perform("review request", () =>
    sources.pulls.requestReviewers(pr, logins),
  );
}
