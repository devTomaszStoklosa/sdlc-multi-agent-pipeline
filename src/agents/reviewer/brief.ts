import type { ChangedFile } from "../../github/ports.ts";
import type { GateResults, ReviewedFinding } from "./review-comment.ts";

// A blocking finding of the previous round with the Developer's replies to it
// (FR-4.15, FR-4.16).
export interface EarlierFinding {
  finding: ReviewedFinding;
  replies: string[];
}

// What the job gathers for a Reviewer session: the issue, which every role
// gets, the plan, the diff, the gate results and the earlier findings, and
// nothing of the Developer's session or reasoning (FR-5.3). All of it is
// untrusted (SEC-8.5).
export interface ReviewerBrief {
  kind: "reviewer";
  // The plan version the change implements: approved for a high-impact
  // change, the latest otherwise (FR-4.6).
  plan: { version: number; body: string; url: string };
  // The reviewed commit, which the workspace holds.
  sha: string;
  // The whole diff of the pull request against the main branch (FR-4.13).
  diff: ChangedFile[];
  gates: GateResults;
  earlier: EarlierFinding[];
}
