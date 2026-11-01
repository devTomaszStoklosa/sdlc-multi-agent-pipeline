import type { EarlierFinding } from "../agents/reviewer/brief.ts";
import {
  developerReplies,
  findingsById,
  openBlocking,
  runReviews,
  type PostedReview,
} from "../agents/reviewer/review-comment.ts";
import type { Run } from "../core/run-store/run-record.ts";
import type { CommentsPort, PullReviewsPort } from "../github/ports.ts";

// Where the reviews of a run live: on its pull request, written by the
// pipeline's app, whose bot login and app id prove the author.
export interface ReviewSources {
  reviews: PullReviewsPort;
  comments: CommentsPort;
  appId: number;
  appLogin: string;
}

// The latest review of a run that requested changes, with the findings it
// left open.
export interface OpenReview {
  sha: string;
  url: string;
  findings: EarlierFinding[];
}

export async function reviewsOfRun(
  sources: ReviewSources,
  run: Run,
): Promise<PostedReview[]> {
  if (run.pr === undefined) return [];
  const reviews = await sources.reviews.listReviews(run.pr);
  return runReviews(reviews, sources.appLogin, run.id);
}

// The Developer's replies, in the threads of the findings and, for a finding
// without a thread, on the pull request (FR-4.15).
async function replies(
  sources: ReviewSources,
  pr: number,
): Promise<Map<string, string[]>> {
  const threads = await sources.reviews.listReviewComments(pr);
  const comments = await sources.comments.listComments(pr);
  return developerReplies([
    ...threads
      .filter((comment) => comment.authorLogin === sources.appLogin)
      .map((comment) => comment.body),
    ...comments
      .filter((comment) => comment.appId === sources.appId)
      .map((comment) => comment.body),
  ]);
}

// The open findings of the run's latest review, if it requested changes: what
// the Developer fixes or answers (FR-4.15) and what the next round checks
// (FR-4.16).
export async function openReview(
  sources: ReviewSources,
  run: Run,
): Promise<OpenReview | undefined> {
  const reviews = await reviewsOfRun(sources, run);
  const last = reviews.at(-1);
  if (run.pr === undefined || last?.record.verdict !== "changes_requested") {
    return undefined;
  }
  const found = findingsById(reviews);
  const answers = await replies(sources, run.pr);
  const findings = openBlocking(last.record).flatMap((id) => {
    const finding = found.get(id);
    return finding ? [{ finding, replies: answers.get(id) ?? [] }] : [];
  });
  return { sha: last.record.sha, url: last.url, findings };
}
