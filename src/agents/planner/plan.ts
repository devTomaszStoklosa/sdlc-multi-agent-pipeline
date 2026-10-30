import { z } from "zod";

export const CHANGE_KINDS = ["add", "modify", "delete"] as const;

const MAX_TEXT = 3000;
const MAX_LINE = 300;
const MAX_HOW = 600;
const MAX_PATH = 200;
const MAX_CRITERIA = 20;
const MAX_FILES = 60;
const MAX_REASONS = 10;
const MAX_LINES = 100_000;

// The plan that a Planner session returns (FR-4.3). The JSON Schema given to
// the session holds only types and required fields, because structured output
// may not support every JSON Schema keyword; `planChecks` enforces the limits
// and formats afterwards. The limits keep the comment under GitHub's size
// limit, and single lines keep table cells and the YAML block intact.
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
    .array(
      z.strictObject({
        path: z.string().describe("Path relative to the repository root."),
        change: z.enum(CHANGE_KINDS),
        why: z.string().describe("One sentence: what changes and why."),
      }),
    )
    .describe("Every file the change adds, modifies or deletes."),
  testing: z.string().describe("How the change is tested."),
  estimatedChangedLines: z
    .number()
    .describe("Estimated added plus deleted lines."),
  highImpact: z.strictObject({
    value: z.boolean(),
    reasons: z
      .array(z.string())
      .describe("Why the change is or is not high-impact, one line each."),
  }),
});

export type Plan = z.infer<typeof planShape>;

type Issues = z.core.$RefinementCtx<Plan>;

function text(issues: Issues, path: string, value: string, max: number) {
  if (value.trim() === "" || value.length > max) {
    issues.addIssue({
      code: "custom",
      path: [path],
      message: `Must hold 1 to ${String(max)} characters.`,
    });
  }
}

function line(issues: Issues, path: string, value: string, max: number) {
  text(issues, path, value, max);
  if (/[\r\n]/.test(value)) {
    issues.addIssue({ code: "custom", path: [path], message: "One line." });
  }
}

function count(issues: Issues, path: string, length: number, range: number[]) {
  const [min = 0, max = 0] = range;
  if (length < min || length > max) {
    issues.addIssue({
      code: "custom",
      path: [path],
      message: `Must have ${String(min)} to ${String(max)} entries.`,
    });
  }
}

// A path inside the repository, without `.` or `..` segments.
export function isRepositoryPath(value: string): boolean {
  if (value.length > MAX_PATH || /[\\\r\n\0]/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((s) => s !== "" && s !== "." && s !== "..");
}

function files(issues: Issues, plan: Plan): void {
  count(issues, "files", plan.files.length, [1, MAX_FILES]);
  const seen = new Set<string>();
  for (const file of plan.files) {
    if (!isRepositoryPath(file.path) || seen.has(file.path)) {
      issues.addIssue({
        code: "custom",
        path: ["files"],
        message: `Invalid or repeated path: ${file.path.slice(0, MAX_PATH)}`,
      });
    }
    seen.add(file.path);
    line(issues, "files.why", file.why, MAX_LINE);
  }
}

function planChecks(plan: Plan, issues: Issues): void {
  text(issues, "summary", plan.summary, MAX_TEXT);
  text(issues, "approach", plan.approach, MAX_TEXT);
  text(issues, "testing", plan.testing, MAX_TEXT);
  count(issues, "acceptance", plan.acceptance.length, [1, MAX_CRITERIA]);
  for (const entry of plan.acceptance) {
    line(issues, "acceptance.criterion", entry.criterion, MAX_LINE);
    line(issues, "acceptance.how", entry.how, MAX_HOW);
  }
  files(issues, plan);
  const lines = plan.estimatedChangedLines;
  if (!Number.isInteger(lines) || lines < 0 || lines > MAX_LINES) {
    issues.addIssue({
      code: "custom",
      path: ["estimatedChangedLines"],
      message: `Must be an integer from 0 to ${String(MAX_LINES)}.`,
    });
  }
  const { reasons, value } = plan.highImpact;
  count(issues, "highImpact.reasons", reasons.length, [
    value ? 1 : 0,
    MAX_REASONS,
  ]);
  for (const reason of reasons) {
    line(issues, "highImpact.reasons", reason, MAX_LINE);
  }
}

export const planSchema = planShape.superRefine(planChecks);

// The JSON Schema of the session's structured output.
export const planJsonSchema = z.toJSONSchema(planShape);
