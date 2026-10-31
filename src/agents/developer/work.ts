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

// Commit types of Conventional Commits (FR-4.9).
export const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "chore",
  "test",
  "perf",
  "build",
  "style",
] as const;

const MAX_SUBJECT = 72;
const MAX_SCOPE = 20;
const MAX_TEXT = 3000;
const MAX_TITLE = 120;
const MAX_ISSUES = 5;
const MAX_FILES = 60;

// What a Developer session returns besides its changes in the workspace. The
// job commits the changes with a message it builds from `commit`, so every
// commit follows Conventional Commits and names the issue (FR-4.9).
const workShape = z.strictObject({
  commit: z.strictObject({
    type: z.enum(COMMIT_TYPES),
    scope: z
      .string()
      .optional()
      .describe("Optional scope: lower-case letters, digits and hyphens."),
    subject: z
      .string()
      .describe(
        "Imperative summary of the change, lower case, no final period.",
      ),
    body: z
      .string()
      .optional()
      .describe("Why the change is made, when the subject does not say it."),
  }),
  summary: z
    .string()
    .describe("What the change does, for the pull request, in a few lines."),
  outOfScope: z
    .array(
      z.strictObject({
        title: z.string().describe("Title of the new issue, one line."),
        body: z.string().describe("Where the problem is and why it matters."),
      }),
    )
    .describe("Problems outside the issue, for new issues (FR-4.10)."),
  planUpdate: z
    .strictObject({
      reason: z
        .string()
        .describe("Why the change needs files outside the plan."),
      files: z
        .array(fileEntryShape)
        .describe("The files the plan lacks, or whose change differs."),
      highImpact: highImpactShape,
    })
    .optional()
    .describe("Only when the change needs files outside the plan (FR-4.11)."),
});

export type DeveloperWork = z.infer<typeof workShape>;
export type PlanUpdate = NonNullable<DeveloperWork["planUpdate"]>;

function workChecks(
  work: DeveloperWork,
  issues: z.core.$RefinementCtx<DeveloperWork>,
): void {
  const { commit, planUpdate } = work;
  checkLine(issues, "commit.subject", commit.subject, MAX_SUBJECT);
  const { scope } = commit;
  if (
    scope !== undefined &&
    !(/^[a-z0-9-]+$/.test(scope) && scope.length <= MAX_SCOPE)
  ) {
    issues.addIssue({
      code: "custom",
      path: ["commit.scope"],
      message: `Lower-case letters, digits and hyphens, at most ${String(MAX_SCOPE)}.`,
    });
  }
  if (commit.body !== undefined) {
    checkText(issues, "commit.body", commit.body, MAX_TEXT);
  }
  checkText(issues, "summary", work.summary, MAX_TEXT);
  checkCount(issues, "outOfScope", work.outOfScope.length, [0, MAX_ISSUES]);
  for (const entry of work.outOfScope) {
    checkLine(issues, "outOfScope.title", entry.title, MAX_TITLE);
    checkText(issues, "outOfScope.body", entry.body, MAX_TEXT);
  }
  if (planUpdate !== undefined) {
    checkText(issues, "planUpdate.reason", planUpdate.reason, MAX_TEXT);
    checkFiles(issues, planUpdate.files, MAX_FILES);
    checkHighImpact(issues, planUpdate.highImpact);
  }
}

export const workSchema = workShape.superRefine(workChecks);

// The JSON Schema of the session's structured output, in draft-07 like the
// Planner's (plan 3.4).
export const workJsonSchema = z.toJSONSchema(workShape, { target: "draft-7" });
