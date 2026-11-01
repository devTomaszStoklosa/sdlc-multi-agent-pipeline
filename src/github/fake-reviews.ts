import type {
  NewReviewComment,
  PullReview,
  PullReviewComment,
  PullReviewsPort,
} from "./ports.ts";

export interface FakeReview extends PullReview {
  pull: number;
  commitId: string;
  comments: readonly NewReviewComment[];
}

// The reviews of the GitHub in memory, written by `login`. Each write is
// recorded in the fake's shared `writes`.
export class FakePullReviews implements PullReviewsPort {
  readonly reviews: FakeReview[] = [];
  readonly comments: (PullReviewComment & { pull: number })[] = [];
  login = "pipeline[bot]";
  private readonly writes: string[];
  private nextId = 5000;

  constructor(writes: string[]) {
    this.writes = writes;
  }

  commentReview(
    pull: number,
    review: {
      commitId: string;
      body: string;
      comments: readonly NewReviewComment[];
    },
  ): Promise<PullReview> {
    this.writes.push(`review #${String(pull)}`);
    const id = this.nextId++;
    const created: FakeReview = {
      id,
      pull,
      authorLogin: this.login,
      body: review.body,
      url: `https://github.test/pull/${String(pull)}#pullrequestreview-${String(id)}`,
      commitId: review.commitId,
      comments: review.comments,
    };
    this.reviews.push(created);
    for (const comment of review.comments) {
      this.comments.push({
        pull,
        id: this.nextId++,
        authorLogin: this.login,
        body: comment.body,
      });
    }
    return Promise.resolve(created);
  }

  listReviews(pull: number): Promise<PullReview[]> {
    return Promise.resolve(
      this.reviews
        .filter((review) => review.pull === pull)
        .map(({ id, authorLogin, body, url }) => ({
          id,
          authorLogin,
          body,
          url,
        })),
    );
  }

  listReviewComments(pull: number): Promise<PullReviewComment[]> {
    return Promise.resolve(
      this.comments
        .filter((comment) => comment.pull === pull)
        .map(({ id, authorLogin, body, inReplyTo }) => ({
          id,
          authorLogin,
          body,
          inReplyTo,
        })),
    );
  }

  replyToComment(pull: number, commentId: number, body: string) {
    this.writes.push(`reply #${String(pull)}`);
    this.comments.push({
      pull,
      id: this.nextId++,
      authorLogin: this.login,
      body,
      inReplyTo: commentId,
    });
    return Promise.resolve();
  }
}
