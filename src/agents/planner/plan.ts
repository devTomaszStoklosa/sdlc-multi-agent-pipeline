import { z } from "zod";
import {
  checkCount,
  checkFiles,
  checkHighImpact,
  checkLine,
  checkText,
  fileEntryShape,
  highImpactShape,
} from "../output-checks.ts";

export { CHANGE_KINDS, isRepositoryPath } from "../output-checks.ts";

const MAX_TEXT = 3000;
const MAX_LINE = 300;
const MAX_HOW = 600;
const MAX_CRITERIA = 20;
const MAX_FILES = 60;
const MAX_LINES = 100_000;

// The plan that a Planner session returns (FR-4.3). The JSON Schema given to
// the session holds only types and required fields; `planChecks` enforces the
// limits and formats afterwards (src/agents/output-checks.ts).
const planShape = z.strictObject({
  summary: z.string().describe("What changes, in a few sentences."),
  approach: z
    .string()
    .describe("The chosen approach and why it beats the alternatives."),
  acceptance: z
    .array(
      z.strictObject({
        criterion: z.string().describe("One acceptance criterion, one line."),
        how: z.string().describe("How the change meets it, one line."),
      }),
    )
    .describe("Every acceptance criterion of the issue."),
  files: z
    .array(fileEntryShape)
    .describe("Every file the change adds, modifies or deletes."),
  testing: z.string().describe("How the change is tested."),
  estimatedChangedLines: z
    .number()
    .describe("Estimated added plus deleted lines."),
  highImpact: highImpactShape,
});

export type Plan = z.infer<typeof planShape>;
export type PlanFile = Plan["files"][number];

function planChecks(plan: Plan, issues: z.core.$RefinementCtx<Plan>): void {
  checkText(issues, "summary", plan.summary, MAX_TEXT);
  checkText(issues, "approach", plan.approach, MAX_TEXT);
  checkText(issues, "testing", plan.testing, MAX_TEXT);
  checkCount(issues, "acceptance", plan.acceptance.length, [1, MAX_CRITERIA]);
  for (const entry of plan.acceptance) {
    checkLine(issues, "acceptance.criterion", entry.criterion, MAX_LINE);
    checkLine(issues, "acceptance.how", entry.how, MAX_HOW);
  }
  checkFiles(issues, plan.files, MAX_FILES);
  const lines = plan.estimatedChangedLines;
  if (!Number.isInteger(lines) || lines < 0 || lines > MAX_LINES) {
    issues.addIssue({
      code: "custom",
      path: ["estimatedChangedLines"],
      message: `Must be an integer from 0 to ${String(MAX_LINES)}.`,
    });
  }
  checkHighImpact(issues, plan.highImpact);
}

export const planSchema = planShape.superRefine(planChecks);

// The JSON Schema of the session's structured output. Claude Code checks
// `--json-schema` with Ajv's default draft, which does not know the 2020-12
// meta-schema that zod names by default.
export const planJsonSchema = z.toJSONSchema(planShape, { target: "draft-7" });
