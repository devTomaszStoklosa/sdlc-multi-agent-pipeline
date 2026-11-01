import { z } from "zod";
import {
  checkCount,
  checkLine,
  checkText,
  isRepositoryPath,
} from "../output-checks.ts";

// The rules a finding may break: the review of the issue and the plan, the
// scope review (QG-7.10), the checklist of spec 7.3, correctness, security and
// tests. A fixed list keeps the identifiers of findings stable (FR-4.14).
export const REVIEW_RULES = [
  "plan",
  "scope",
  "srp",
  "ocp",
  "lsp",
  "isp",
  "dip",
  "dry",
  "kiss",
  "yagni",
  "demeter",
  "correctness",
  "security",
  "tests",
] as const;

export type ReviewRule = (typeof REVIEW_RULES)[number];

const MAX_FINDINGS = 30;
const MAX_EARLIER = 60;
const MAX_TEXT = 1500;
const MAX_LINE = 300;
const MAX_ID = 40;
const MAX_LINE_NUMBER = 1_000_000;

const findingShape = z.strictObject({
  path: z.string().describe("A file that the diff changes."),
  line: z
    .number()
    .describe(
      "The line in the new version of the file, from 1; 0 for the whole file.",
    ),
  rule: z.enum(REVIEW_RULES),
  blocking: z.boolean(),
  nonBlockingReason: z
    .string()
    .optional()
    .describe("Only for a non-blocking finding: why it does not block."),
  description: z.string().describe("What is wrong and why."),
  suggestion: z.string().describe("How to fix it."),
});

// What a Reviewer session returns (FR-4.14, FR-4.16). The job derives the
// identifiers of the findings and the verdict from it, so the model can
// neither invent an identifier nor approve a change with a blocking finding
// (FR-4.17).
const reviewShape = z.strictObject({
  findings: z
    .array(findingShape)
    .describe("Every problem of the change; empty when there is none."),
  earlier: z
    .array(
      z.strictObject({
        id: z.string().describe("The identifier of an earlier finding."),
        resolved: z.boolean(),
        note: z.string().describe("Why it is resolved or not, one line."),
      }),
    )
    .describe("One entry for each earlier finding of the prompt."),
});

export type Review = z.infer<typeof reviewShape>;
export type ReviewFinding = Review["findings"][number];

function findingChecks(
  issues: z.core.$RefinementCtx,
  finding: ReviewFinding,
): void {
  const { line } = finding;
  if (!isRepositoryPath(finding.path)) {
    issues.addIssue({
      code: "custom",
      path: ["findings.path"],
      message: "A path inside the repository.",
    });
  }
  if (!Number.isInteger(line) || line < 0 || line > MAX_LINE_NUMBER) {
    issues.addIssue({
      code: "custom",
      path: ["findings.line"],
      message: `An integer from 0 to ${String(MAX_LINE_NUMBER)}.`,
    });
  }
  checkText(issues, "findings.description", finding.description, MAX_TEXT);
  checkText(issues, "findings.suggestion", finding.suggestion, MAX_TEXT);
  // A failed checklist item blocks unless the Reviewer says why not (spec 7.3).
  const reason = finding.nonBlockingReason;
  if (!finding.blocking && reason === undefined) {
    issues.addIssue({
      code: "custom",
      path: ["findings.nonBlockingReason"],
      message: "A non-blocking finding needs a reason.",
    });
  }
  if (reason !== undefined) {
    checkLine(issues, "findings.nonBlockingReason", reason, MAX_LINE);
  }
}

function reviewChecks(
  review: Review,
  issues: z.core.$RefinementCtx<Review>,
): void {
  checkCount(issues, "findings", review.findings.length, [0, MAX_FINDINGS]);
  for (const finding of review.findings) findingChecks(issues, finding);
  checkCount(issues, "earlier", review.earlier.length, [0, MAX_EARLIER]);
  for (const entry of review.earlier) {
    checkLine(issues, "earlier.id", entry.id, MAX_ID);
    checkLine(issues, "earlier.note", entry.note, MAX_LINE);
  }
}

export const reviewSchema = reviewShape.superRefine(reviewChecks);

// The JSON Schema of the session's structured output, in draft-07 like the
// other roles' (plan 3.4).
export const reviewJsonSchema = z.toJSONSchema(reviewShape, {
  target: "draft-7",
});
