import { briefOf } from "../brief.ts";
import {
  cut,
  dataSection,
  diffText,
  issueAndPlan,
  type DataPiece,
} from "../prompt-data.ts";
import type { RoleInput } from "../role-runner.ts";
import type { EarlierFinding, ReviewerBrief } from "./brief.ts";
import { where } from "./review-comment.ts";

// Limits that keep the prompt, and so the use of the plan's limits, small.
// The Reviewer reads more of a file in the workspace when it needs to.
const MAX_TEXT = 20_000;
const MAX_DIFF = 80_000;
const MAX_EARLIER = 30_000;

function brief(input: RoleInput): ReviewerBrief {
  const found = briefOf(input.brief, "reviewer");
  if (found === undefined) throw new Error("A Reviewer session needs a brief.");
  return found;
}

function gatesLine(given: ReviewerBrief): string {
  const jobs = given.gates.jobs.map((job) => `${job.name} (${job.conclusion})`);
  return jobs.length === 0
    ? "The gates passed on this commit."
    : `The gates passed on this commit: ${jobs.join(", ")}.`;
}

function facts(input: RoleInput, given: ReviewerBrief): string[] {
  const ids = given.earlier.map((entry) => entry.finding.id);
  return [
    `Issue #${String(input.issue.number)}, run ${input.runId}, review round ${String(input.reviewRound)}. The working directory holds commit \`${given.sha}\`, the head of the pull request. The change implements version ${String(given.plan.version)} of the plan.`,
    gatesLine(given),
    ids.length === 0
      ? "There are no earlier findings: return an empty `earlier` list."
      : `The previous round left these blocking findings open; return an \`earlier\` entry for each: ${ids.join(", ")}.`,
  ];
}

// Open findings of a review with the Developer's replies, for the Developer
// that answers them and for the round that checks them.
export function findingsText(
  entries: readonly EarlierFinding[],
  max: number,
): string {
  const texts = entries.map(({ finding, replies }) =>
    [
      `${finding.id} · rule ${finding.rule} · ${where(finding)}`,
      `Description: ${finding.description}`,
      `Suggestion: ${finding.suggestion}`,
      ...(replies.length === 0
        ? ["The Developer did not reply."]
        : replies.map((reply) => `Developer's reply: ${reply}`)),
    ].join("\n"),
  );
  return cut(texts.join("\n\n"), max);
}

function pieces(input: RoleInput, given: ReviewerBrief): DataPiece[] {
  return [
    ...issueAndPlan(input.issue, given.plan, MAX_TEXT),
    ["diff against the main branch", diffText(given.diff, MAX_DIFF)],
    ...(given.earlier.length === 0
      ? []
      : [
          [
            "earlier findings and the Developer's replies",
            findingsText(given.earlier, MAX_EARLIER),
          ] as const,
        ]),
  ];
}

// The prompt of a Reviewer session: the instructions from prompts/, the facts
// of the round, then the issue, the plan, the diff and the earlier findings as
// untrusted data (SEC-8.5). Nothing of the Developer's session reaches it
// (FR-5.3).
export function reviewerPrompt(
  input: RoleInput,
  instructions: string,
  nonce: string,
): string {
  const given = brief(input);
  return [
    instructions.trim(),
    "## This review",
    ...facts(input, given),
    ...dataSection(pieces(input, given), nonce),
  ].join("\n\n");
}
