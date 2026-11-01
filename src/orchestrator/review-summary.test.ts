import { describe, expect, it } from "vitest";
import { aFinding, aRecord } from "../agents/reviewer/fixtures.ts";
import { reviewSummary, withReviewSummary } from "./review-summary.ts";

const PLAN = { version: 2, body: "", url: "https://github.test/plan" };

describe("the review summary of a pull request", () => {
  it("lists the plan, the gates, the rounds and the open non-blocking findings", () => {
    const summary = reviewSummary(PLAN, [
      { record: aRecord(), url: "https://github.test/r/1" },
      {
        record: aRecord({
          round: 2,
          verdict: "approve",
          findings: [
            aFinding({
              id: "F-000000000002",
              blocking: false,
              nonBlockingReason: "Kosmetyka.",
            }),
          ],
          earlier: [{ id: "F-0123456789ab", resolved: true, note: "Ok." }],
          gates: {
            url: "https://github.test/runs/9",
            jobs: [{ name: "test", conclusion: "success" }],
          },
        }),
        url: "https://github.test/r/2",
      },
    ]);
    expect(summary).toContain(
      "- **Plan:** [wersja 2](https://github.test/plan)",
    );
    expect(summary).toContain(
      "- **Bramki:** zaliczone na `abc1234` ([run](https://github.test/runs/9)): test (success).",
    );
    expect(summary).toContain(
      "- **Runda 1** ([review](https://github.test/r/1)): `changes_requested`; blokujące: `F-0123456789ab` (`kiss`, `src/price.ts:2`).",
    );
    expect(summary).toContain(
      "- **Runda 2** ([review](https://github.test/r/2)): `approve`; rozwiązane: `F-0123456789ab`.",
    );
    expect(summary).toContain(
      "- `F-000000000002` (`kiss`, `src/price.ts:2`): Zbyt złożone wyliczenie rabatu. Powód, dla którego nie blokuje: Kosmetyka.",
    );
  });

  it("replaces an earlier summary and keeps the rest of the body", () => {
    const first = withReviewSummary(
      "Closes #1\n\nOpis.\n",
      "<!-- sdlc-review-summary -->\nA\n<!-- /sdlc-review-summary -->",
    );
    expect(first).toBe(
      "Closes #1\n\nOpis.\n\n<!-- sdlc-review-summary -->\nA\n<!-- /sdlc-review-summary -->",
    );
    const second = withReviewSummary(
      `${first}\n\nDopisek.`,
      "<!-- sdlc-review-summary -->\nB\n<!-- /sdlc-review-summary -->",
    );
    expect(second).toBe(
      "Closes #1\n\nOpis.\n\n<!-- sdlc-review-summary -->\nB\n<!-- /sdlc-review-summary -->\n\nDopisek.",
    );
  });
});
