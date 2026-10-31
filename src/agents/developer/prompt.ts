import { briefOf } from "../brief.ts";
import { cut, dataSection, type DataPiece } from "../prompt-data.ts";
import type { RoleInput } from "../role-runner.ts";
import type { DeveloperBrief } from "./brief.ts";

// Limits that keep the prompt, and so the use of the plan's limits, small.
const MAX_TEXT = 20_000;
const MAX_LOG = 12_000;

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
    ...(input.findings.length === 0
      ? []
      : [
          `The review reported blocking findings: ${input.findings.join(", ")}. Fix them within the plan.`,
        ]),
  ];
}

function pieces(input: RoleInput, given: DeveloperBrief): DataPiece[] {
  return [
    ["issue title", input.issue.title],
    ["issue body", cut(input.issue.body, MAX_TEXT)],
    [
      `plan, version ${String(given.plan.version)}`,
      cut(given.plan.body, MAX_TEXT),
    ],
    ...given.gateFailures.map((failure): DataPiece => [
      `log of the failed gate job ${failure.job}`,
      cut(failure.log, MAX_LOG),
    ]),
  ];
}

// The prompt of a Developer session: the instructions from prompts/, the
// facts of the stage, then the issue, the plan and the gate logs as untrusted
// data (SEC-8.5).
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
