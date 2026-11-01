import type { DeveloperBrief } from "../agents/developer/brief.ts";
import type { FindingReply } from "../agents/developer/work.ts";
import {
  findingThreads,
  replyComment,
} from "../agents/reviewer/review-comment.ts";
import type { EffectScope } from "./role-effects.ts";

// The replies to findings that the latest review left open. A reply to any
// other identifier has nothing to answer and is dropped.
export function openFindingReplies(
  brief: DeveloperBrief,
  replies: readonly FindingReply[] = [],
): FindingReply[] {
  const open = new Set(brief.review?.findings.map((e) => e.finding.id));
  return replies.filter((entry) => open.has(entry.finding));
}

// Each reply in the thread of its finding, or on the pull request when the
// finding has no thread, each after the check of FR-4.28c (FR-4.15).
export async function postReplies(
  scope: EffectScope,
  replies: readonly FindingReply[],
): Promise<void> {
  const { pr } = scope.run;
  if (replies.length === 0 || pr === undefined) return;
  const { app } = scope.context;
  const comments = await app.reviews.listReviewComments(pr);
  const threads = findingThreads(comments, scope.appLogin);
  for (const { finding, reply } of replies) {
    const body = replyComment(finding, reply);
    const thread = threads.get(finding);
    await scope.guard.perform("finding reply", async () => {
      if (thread === undefined) await app.comments.createComment(pr, body);
      else await app.reviews.replyToComment(pr, thread, body);
    });
  }
}
