import { createHash } from "node:crypto";
import type { ReviewRule } from "./review.ts";

const ID_LENGTH = 12;

// The anchor of a finding in the code: the text of its line with the white
// space collapsed, so the finding keeps its identifier when the code around it
// moves or is reindented. A finding on the whole file, or on a line the file
// does not have, anchors to the file itself.
export function anchorOf(content: string | undefined, line: number): string {
  if (content === undefined || line < 1) return "";
  const text = content.replaceAll("\r\n", "\n").split("\n")[line - 1];
  return text === undefined ? "" : text.trim().replace(/\s+/g, " ");
}

// The stable identifier of a finding (FR-4.14): a hash of its rule, its file
// and its anchor. The same rule at the same place of the code gets the same
// identifier in every round, which is how a repeated finding is recognised
// (FR-4.18).
export function findingId(
  rule: ReviewRule,
  path: string,
  anchor: string,
): string {
  const hash = createHash("sha256")
    .update(`${rule}\n${path}\n${anchor}`)
    .digest("hex");
  return `F-${hash.slice(0, ID_LENGTH)}`;
}
