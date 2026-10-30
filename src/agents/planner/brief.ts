import type { ChangedFile } from "../../github/ports.ts";

export interface BriefComment {
  author: string;
  at: string;
  body: string;
}

// The branch of the open pull request of the issue's previous run, which a
// new run continues (FR-4.28b), against the main branch.
export interface BranchDiff {
  branch: string;
  base: string;
  files: ChangedFile[];
}

// What the job gathers for a Planner session: only the data the task needs
// (SEC-8.10). All of it is untrusted (SEC-8.5).
export interface PlannerBrief {
  // Comments of people with write permission (FR-4.23), oldest first.
  comments: BriefComment[];
  // Earlier versions of the plan of every run of the issue (FR-4.6).
  previousPlans: { at: string; body: string }[];
  // The stop summary of the previous run, if it was stopped (FR-4.28f).
  stopSummary?: string;
  branchDiff?: BranchDiff;
}
