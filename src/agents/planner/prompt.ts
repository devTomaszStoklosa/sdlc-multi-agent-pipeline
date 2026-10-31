import { briefOf } from "../brief.ts";
import { cut, dataSection, type DataPiece } from "../prompt-data.ts";
import type { RoleInput } from "../role-runner.ts";
import type { BranchDiff, PlannerBrief } from "./brief.ts";

// Limits that keep the prompt, and so the use of the plan's limits, small.
const MAX_TEXT = 20_000;
const MAX_COMMENT = 8000;
const MAX_DIFF = 60_000;

const EMPTY: PlannerBrief = {
  kind: "planner",
  comments: [],
  previousPlans: [],
};

function diffText(diff: BranchDiff): string {
  const files = diff.files.map(
    (file) =>
      `--- ${file.path} (+${String(file.additions)} -${String(file.deletions)})\n${file.patch ?? "(no patch: the file is large or binary)"}`,
  );
  return cut(files.join("\n\n"), MAX_DIFF);
}

function pieces(input: RoleInput): DataPiece[] {
  const brief = briefOf(input.brief, "planner") ?? EMPTY;
  const { stopSummary, branchDiff } = brief;
  return [
    ["issue title", input.issue.title],
    ["issue body", cut(input.issue.body, MAX_TEXT)],
    ...brief.comments.map((comment): DataPiece => [
      `comment by ${comment.author} at ${comment.at}`,
      cut(comment.body, MAX_COMMENT),
    ]),
    ...brief.previousPlans.map((plan): DataPiece => [
      `earlier plan version posted at ${plan.at}`,
      cut(plan.body, MAX_TEXT),
    ]),
    ...(stopSummary === undefined
      ? []
      : [
          [
            "stop summary of the previous run",
            cut(stopSummary, MAX_COMMENT),
          ] as const,
        ]),
    ...(branchDiff === undefined
      ? []
      : [
          [
            `diff of branch ${branchDiff.branch} against ${branchDiff.base}`,
            diffText(branchDiff),
          ] as const,
        ]),
  ];
}

// The prompt of a Planner session: the instructions from prompts/, then the
// issue and the brief as untrusted data (SEC-8.5).
export function plannerPrompt(
  input: RoleInput,
  instructions: string,
  nonce: string,
): string {
  return [
    instructions.trim(),
    "## This run",
    `Issue #${String(input.issue.number)}, run ${input.runId}. You write version ${String(input.planVersion + 1)} of the plan. The working directory holds the repository's main branch.`,
    ...dataSection(pieces(input), nonce),
  ].join("\n\n");
}
