import type { ReviewedFinding } from "../agents/reviewer/review-comment.ts";
import { findingComment } from "../agents/reviewer/review-comment.ts";
import type { ChangedFile, NewReviewComment } from "../github/ports.ts";

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// The lines of the new version of a file that its patch shows, the only lines
// a review comment may be on.
export function commentableLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let next = 0;
  for (const text of patch.split("\n")) {
    const hunk = HUNK.exec(text);
    if (hunk) {
      next = Number(hunk[1]);
    } else if (next > 0 && (text.startsWith(" ") || text.startsWith("+"))) {
      lines.add(next++);
    }
  }
  return lines;
}

export interface Placement {
  comments: NewReviewComment[];
  // Findings in files the diff does not change, which have no comment and
  // live only in the review's body.
  detached: Set<string>;
}

// Each finding as a comment on its line when the diff shows the line, else on
// its file (FR-4.14).
export function placeFindings(
  findings: readonly ReviewedFinding[],
  diff: readonly ChangedFile[],
): Placement {
  const files = new Map(diff.map((file) => [file.path, file]));
  const comments: NewReviewComment[] = [];
  const detached = new Set<string>();
  for (const finding of findings) {
    const file = files.get(finding.path);
    if (file === undefined) {
      detached.add(finding.id);
      continue;
    }
    const shown = commentableLines(file.patch ?? "").has(finding.line);
    comments.push({
      path: finding.path,
      line: shown ? finding.line : undefined,
      body: findingComment(finding),
    });
  }
  return { comments, detached };
}
