import { briefOf } from "../brief.ts";
import {
  cut,
  dataSection,
  issueAndPlan,
  type DataPiece,
} from "../prompt-data.ts";
import { findingsText } from "../reviewer/prompt.ts";
import type { RoleInput } from "../role-runner.ts";
import type { DeveloperBrief } from "./brief.ts";

// Limits that keep the prompt, and so the use of the plan's limits, small.
const MAX_TEXT = 20_000;
const MAX_LOG = 12_000;
const MAX_FINDINGS = 30_000;

function brief(input: RoleInput): DeveloperBrief {
  const found = briefOf(input.brief, "developer");
  if (found === undefined)
    throw new Error("A Developer session needs a brief.");
  return found;
}

function facts(input: RoleInput, given: DeveloperBrief): string[] {
  const { commands, conflicts, gateFailures, branch } = given;
  const where =
    branch === undefined
      ? "the repository's main branch; the pipeline creates the run's branch when it pushes"
      : `the run's branch \`${branch}\``;
  return [
    `Issue #${String(input.issue.number)}, run ${input.runId}. You implement version ${String(given.plan.version)} of the plan. The working directory holds ${where}.`,
    `The pipeline installed the dependencies with \`${commands.install}\`. The lint command is \`${commands.lint}\` and the test command is \`${commands.test}\`.`,
    ...(conflicts.length === 0
      ? []
      : [
          `The pipeline merged the main branch into the branch. These files still conflict; resolve them first: ${conflicts.map((file) => `\`${file}\``).join(", ")}.`,
        ]),
    ...(gateFailures.length === 0
      ? []
      : [
          "The gates failed on your last push. Their logs follow; fix the cause within the plan.",
        ]),
    ...(given.review === undefined
      ? []
      : [
          `The review of commit \`${given.review.sha.slice(0, 7)}\` left blocking findings open; they follow. Fix each within the plan, or, when a finding is wrong, explain why in \`replies\` instead of changing the code.`,
        ]),
  ];
}

function pieces(input: RoleInput, given: DeveloperBrief): DataPiece[] {
  return [
    ...issueAndPlan(input.issue, given.plan, MAX_TEXT),
    ...given.gateFailures.map((failure): DataPiece => [
      `log of the failed gate job ${failure.job}`,
      cut(failure.log, MAX_LOG),
    ]),
    ...(given.review === undefined
      ? []
      : [
          [
            "open review findings",
            findingsText(given.review.findings, MAX_FINDINGS),
          ] as const,
        ]),
  ];
}

// The prompt of a Developer session: the instructions from prompts/, the
// facts of the stage, then the issue, the plan, the gate logs and the review
// findings as untrusted data (SEC-8.5).
export function developerPrompt(
  input: RoleInput,
  instructions: string,
  nonce: string,
): string {
  const given = brief(input);
  return [
    instructions.trim(),
    "## This run",
    ...facts(input, given),
    ...dataSection(pieces(input, given), nonce),
  ].join("\n\n");
}
