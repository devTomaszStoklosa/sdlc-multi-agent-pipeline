import { describe, expect, it } from "vitest";
import { configText } from "../../config/fixtures.ts";
import type { RoleInput } from "../role-runner.ts";
import { aFinding, aReviewerBrief } from "./fixtures.ts";
import { reviewerPrompt } from "./prompt.ts";
import { reviewSchema } from "./review.ts";

const NONCE = "abc123";

function input(brief: RoleInput["brief"] = aReviewerBrief()): RoleInput {
  return {
    role: "reviewer",
    issue: { number: 12, title: "Rabat", body: "Dodaj rabat." },
    runId: "12-1",
    planVersion: 1,
    reviewRound: 1,
    pushes: 1,
    findings: [],
    attempt: 1,
    config: configText(),
    maxTurns: 50,
    brief,
  };
}

describe("reviewerPrompt", () => {
  it("gives the facts of the round, the plan and the diff as data (FR-5.3)", () => {
    const prompt = reviewerPrompt(input(), "# Reviewer", NONCE);
    expect(prompt.startsWith("# Reviewer\n\n## This review")).toBe(true);
    expect(prompt).toContain(
      "review round 1. The working directory holds commit `abc1234def`",
    );
    expect(prompt).toContain(
      "The gates passed on this commit: test (success).",
    );
    expect(prompt).toContain("There are no earlier findings");
    expect(prompt).toContain(
      `<data-${NONCE} source="diff against the main branch">\n--- src/price.ts (+2 -0)\n@@ -1,1 +1,3 @@`,
    );
    expect(prompt).not.toContain("earlier findings and the Developer");
  });

  it("lists the open findings of the previous round with the replies (FR-4.16)", () => {
    const brief = aReviewerBrief({
      earlier: [
        { finding: aFinding(), replies: ["**Odpowiedź Developera:** Celowe."] },
      ],
    });
    const prompt = reviewerPrompt(input(brief), "# Reviewer", NONCE);
    expect(prompt).toContain(
      "return an `earlier` entry for each: F-0123456789ab.",
    );
    expect(prompt).toContain(
      "F-0123456789ab · rule kiss · src/price.ts:2\nDescription: Zbyt złożone",
    );
    expect(prompt).toContain(
      "Developer's reply: **Odpowiedź Developera:** Celowe.",
    );
  });

  it("needs a Reviewer brief", () => {
    const planner = {
      kind: "planner" as const,
      comments: [],
      previousPlans: [],
    };
    expect(() => reviewerPrompt(input(planner), "# Reviewer", NONCE)).toThrow(
      "needs a brief",
    );
  });
});

describe("reviewSchema", () => {
  const finding = {
    path: "src/price.ts",
    line: 2,
    rule: "kiss",
    blocking: true,
    description: "Opis.",
    suggestion: "Sugestia.",
  };

  it("accepts findings and the states of earlier ones", () => {
    const review = {
      findings: [finding],
      earlier: [{ id: "F-0123456789ab", resolved: true, note: "Poprawione." }],
    };
    expect(reviewSchema.safeParse(review).success).toBe(true);
  });

  it("needs a reason for a non-blocking finding (spec 7.3)", () => {
    const without = { ...finding, blocking: false };
    const parse = (given: object) =>
      reviewSchema.safeParse({ findings: [given], earlier: [] }).success;
    expect(parse(without)).toBe(false);
    expect(parse({ ...without, nonBlockingReason: "Drobiazg." })).toBe(true);
  });

  it("rejects a path outside the repository and a line that is no line", () => {
    const parse = (given: object) =>
      reviewSchema.safeParse({ findings: [given], earlier: [] }).success;
    expect(parse({ ...finding, path: "../secret" })).toBe(false);
    expect(parse({ ...finding, line: 1.5 })).toBe(false);
    expect(parse({ ...finding, line: -1 })).toBe(false);
    expect(parse({ ...finding, description: "" })).toBe(false);
  });
});
