import type { CommentsPort, IssueComment } from "../../github/ports.ts";
import { decodeRecord, encodeRecord } from "./codec.ts";
import type { RunRecord } from "./run-record.ts";
import {
  nextRevision,
  type RunStateStore,
  type StoredRecord,
  type WriteResult,
} from "./store.ts";

// The run state in a hidden comment of the issue (plan 2.2). Only a comment of
// the pipeline's GitHub App counts, so nobody else can plant a state. A state
// comment that does not match the schema stops the job instead of being
// ignored, because a missing state would start a new run (fail closed).
export class CommentRunStateStore implements RunStateStore {
  private readonly comments: CommentsPort;
  private readonly appId: number;

  constructor(comments: CommentsPort, appId: number) {
    this.comments = comments;
    this.appId = appId;
  }

  async read(issue: number): Promise<StoredRecord | undefined> {
    return (await this.find(issue))?.stored;
  }

  async write(
    record: RunRecord,
    expected: number | undefined,
  ): Promise<WriteResult> {
    const current = await this.find(record.issue);
    if (current?.stored.record.revision !== expected) {
      return { ok: false, current: current?.stored };
    }
    const revision = nextRevision(expected);
    const body = encodeRecord({ ...record, revision });
    if (current === undefined) {
      await this.comments.createComment(record.issue, body);
    } else {
      await this.comments.updateComment(current.comment.id, body);
    }
    // Two writers that read the same revision both write. The second write
    // wins, and the first writer sees that here.
    const written = await this.find(record.issue);
    if (written?.comment.body !== body) {
      return { ok: false, current: written?.stored };
    }
    return { ok: true, stored: written.stored };
  }

  private async find(
    issue: number,
  ): Promise<{ comment: IssueComment; stored: StoredRecord } | undefined> {
    const comments = await this.comments.listComments(issue);
    for (const comment of comments) {
      if (comment.appId !== this.appId) continue;
      const decoded = decodeRecord(comment.body);
      if (!decoded.found) continue;
      if (!decoded.ok) {
        throw new Error(
          `Invalid run state in ${comment.url}: ${decoded.error}`,
        );
      }
      return {
        comment,
        stored: {
          record: decoded.record,
          url: comment.url,
          updatedAt: comment.updatedAt,
        },
      };
    }
    return undefined;
  }
}
