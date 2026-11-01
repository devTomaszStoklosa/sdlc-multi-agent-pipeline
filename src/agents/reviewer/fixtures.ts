import type { ReviewerBrief } from "./brief.ts";
import type { ReviewedFinding, ReviewRecord } from "./review-comment.ts";

export function aFinding(fields: Partial<ReviewedFinding> = {}) {
  const finding: ReviewedFinding = {
    id: "F-0123456789ab",
    path: "src/price.ts",
    line: 2,
    rule: "kiss",
    blocking: true,
    description: "Zbyt złożone wyliczenie rabatu.",
    suggestion: "Uprość warunek.",
    ...fields,
  };
  return finding;
}

export function aRecord(fields: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    run: "12-1",
    round: 1,
    sha: "abc1234def",
    verdict: "changes_requested",
    findings: [aFinding()],
    earlier: [],
    gates: { url: "https://github.test/runs/9", jobs: [] },
    ...fields,
  };
}

export function aReviewerBrief(
  fields: Partial<ReviewerBrief> = {},
): ReviewerBrief {
  return {
    kind: "reviewer",
    plan: {
      version: 1,
      body: "### Plan, wersja 1 (przebieg 12-1)",
      url: "https://github.test/issues/12#issuecomment-1",
    },
    sha: "abc1234def",
    diff: [
      {
        path: "src/price.ts",
        additions: 2,
        deletions: 0,
        patch:
          "@@ -1,1 +1,3 @@\n export const a = 1;\n+export const b = 2;\n+export const c = 3;",
      },
    ],
    gates: {
      url: "https://github.test/runs/9",
      jobs: [{ name: "test", conclusion: "success" }],
    },
    earlier: [],
    ...fields,
  };
}
