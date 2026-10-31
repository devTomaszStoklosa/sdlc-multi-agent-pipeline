import { z } from "zod";

// Checks of a session's structured output that its JSON Schema leaves out,
// because structured output may not support every JSON Schema keyword. The
// limits keep comments under GitHub's size limit, and single lines keep table
// cells and YAML blocks intact.

type Issues = z.core.$RefinementCtx;

const MAX_PATH = 200;
const MAX_LINE = 300;
const MAX_REASONS = 10;

export function checkText(
  issues: Issues,
  path: string,
  value: string,
  max: number,
): void {
  if (value.trim() === "" || value.length > max) {
    issues.addIssue({
      code: "custom",
      path: [path],
      message: `Must hold 1 to ${String(max)} characters.`,
    });
  }
}

export function checkLine(
  issues: Issues,
  path: string,
  value: string,
  max: number,
): void {
  checkText(issues, path, value, max);
  if (/[\r\n]/.test(value)) {
    issues.addIssue({ code: "custom", path: [path], message: "One line." });
  }
}

export function checkCount(
  issues: Issues,
  path: string,
  length: number,
  range: readonly number[],
): void {
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

export const CHANGE_KINDS = ["add", "modify", "delete"] as const;

// A file of a plan: the Planner's, or the Developer's update of it.
export const fileEntryShape = z.strictObject({
  path: z.string().describe("Path relative to the repository root."),
  change: z.enum(CHANGE_KINDS),
  why: z.string().describe("One sentence: what changes and why."),
});

export const highImpactShape = z.strictObject({
  value: z.boolean(),
  reasons: z
    .array(z.string())
    .describe("Why the change is or is not high-impact, one line each."),
});

export function checkFiles(
  issues: Issues,
  files: readonly z.infer<typeof fileEntryShape>[],
  max: number,
): void {
  checkCount(issues, "files", files.length, [1, max]);
  const seen = new Set<string>();
  for (const file of files) {
    if (!isRepositoryPath(file.path) || seen.has(file.path)) {
      issues.addIssue({
        code: "custom",
        path: ["files"],
        message: `Invalid or repeated path: ${file.path.slice(0, MAX_PATH)}`,
      });
    }
    seen.add(file.path);
    checkLine(issues, "files.why", file.why, MAX_LINE);
  }
}

// A high-impact assessment needs a reason.
export function checkHighImpact(
  issues: Issues,
  assessment: z.infer<typeof highImpactShape>,
): void {
  const { reasons, value } = assessment;
  checkCount(issues, "highImpact.reasons", reasons.length, [
    value ? 1 : 0,
    MAX_REASONS,
  ]);
  for (const reason of reasons) {
    checkLine(issues, "highImpact.reasons", reason, MAX_LINE);
  }
}
