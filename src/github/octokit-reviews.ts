import { RepoApi } from "./octokit-issues.ts";
import type {
  NewReviewComment,
  PullReview,
  PullReviewComment,
  PullReviewsPort,
} from "./ports.ts";

interface RawReview {
  id: number;
  user: { login: string } | null;
  body: string | null;
  html_url: string;
}

function toReview(review: RawReview): PullReview {
  return {
    id: review.id,
    authorLogin: review.user?.login ?? "",
    body: review.body ?? "",
    url: review.html_url,
  };
}

export class GitHubPullReviews extends RepoApi implements PullReviewsPort {
  // Every review is a comment: the event is fixed, so this port can neither
  // approve nor request changes (FR-5.2, FR-6.2). A line comment must be on a
  // line of the diff; the others go on their file, which the review endpoint
  // does not support, so each is a comment of its own.
  async commentReview(
    pull: number,
    review: {
      commitId: string;
      body: string;
      comments: readonly NewReviewComment[];
    },
  ): Promise<PullReview> {
    const onLines = review.comments.flatMap(({ path, line, body }) =>
      line === undefined ? [] : [{ path, line, body, side: "RIGHT" as const }],
    );
    const { data } = await this.octokit.rest.pulls.createReview({
      ...this.repo,
      pull_number: pull,
      commit_id: review.commitId,
      body: review.body,
      event: "COMMENT",
      comments: onLines,
    });
    for (const comment of review.comments) {
      if (comment.line !== undefined) continue;
      await this.octokit.rest.pulls.createReviewComment({
        ...this.repo,
        pull_number: pull,
        commit_id: review.commitId,
        path: comment.path,
        body: comment.body,
        subject_type: "file",
      });
    }
    return toReview(data);
  }

  async listReviews(pull: number): Promise<PullReview[]> {
    const reviews = await this.octokit.paginate(
      this.octokit.rest.pulls.listReviews,
      { ...this.repo, pull_number: pull, per_page: 100 },
    );
    return reviews.map(toReview);
  }

  async listReviewComments(pull: number): Promise<PullReviewComment[]> {
    const comments = await this.octokit.paginate(
      this.octokit.rest.pulls.listReviewComments,
      { ...this.repo, pull_number: pull, per_page: 100 },
    );
    return comments.map((comment) => ({
      id: comment.id,
      authorLogin: comment.user.login,
      body: comment.body,
      inReplyTo: comment.in_reply_to_id,
    }));
  }

  async replyToComment(
    pull: number,
    commentId: number,
    body: string,
  ): Promise<void> {
    await this.octokit.rest.pulls.createReplyForReviewComment({
      ...this.repo,
      pull_number: pull,
      comment_id: commentId,
      body,
    });
  }
}
