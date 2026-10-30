import { describe, expect, it } from "vitest";
import { aPlan } from "./fixtures.ts";
import type { Classification } from "./high-impact.ts";
import { isPlanComment, parsePlanBlock, planComment } from "./plan-comment.ts";
import type { Plan } from "./plan.ts";

const NORMAL: Classification = {
  highImpact: false,
  reasons: [{ source: "model", text: "Jedna funkcja." }],
};

function comment(plan: Plan = aPlan(), classification = NORMAL): string {
  return planComment({
    runId: "12-2",
    version: 3,
    plan,
    classification,
    approvalLabel: "plan:approved",
  });
}

describe("planComment", () => {
  it("has every element of FR-4.3", () => {
    const body = comment();
    expect(body).toMatch(/^### Plan, wersja 3 \(przebieg 12-2\)\n/);
    for (const heading of [
      "**Klasyfikacja:** zwykła zmiana",
      "- ocena Plannera: Jedna funkcja.",
      "#### Podsumowanie",
      "#### Podejście",
      "| Rabat 10% od 100 zł | Funkcja discount i jej test |",
      "#### Pliki",
      "#### Testy",
    ]) {
      expect(body).toContain(heading);
    }
    expect(isPlanComment(body)).toBe(true);
  });

  it("asks for the approval label on a high-impact plan", () => {
    const body = comment(aPlan(), {
      highImpact: true,
      reasons: [{ source: "rule", text: "pliki CI: `.github/x.yml`" }],
    });
    expect(body).toContain("etykietą `plan:approved`");
    expect(body).toContain("- reguła: pliki CI: `.github/x.yml`");
  });

  it("has a machine-readable file list that parses back", () => {
    const plan = aPlan({
      files: [
        { path: "src/a.ts", change: "add", why: "Has ``` and: a colon" },
        { path: "src/b.ts", change: "delete", why: "true" },
      ],
    });
    expect(parsePlanBlock(comment(plan))).toEqual({
      run: "12-2",
      version: 3,
      high_impact: false,
      files: [
        { path: "src/a.ts", change: "add", why: "Has ``` and: a colon" },
        { path: "src/b.ts", change: "delete", why: "true" },
      ],
    });
  });

  it("neutralizes secrets, markers, mentions and table breaks from the session", () => {
    const token = `sk-ant-oat01-${"x".repeat(40)}`;
    const body = comment(
      aPlan({
        summary: `Ping @octocat ${token} <!-- sdlc-run-state\n{} -->`,
        acceptance: [{ criterion: "a | b", how: "c" }],
      }),
    );
    expect(body).not.toContain(token);
    expect(body).not.toContain("<!--");
    expect(body).not.toContain("@octocat");
    expect(body).toContain("| a \\| b | c |");
  });

  it("finds no block in other comments", () => {
    expect(parsePlanBlock("### Plan, wersja 1\n\nText.")).toBeUndefined();
    expect(isPlanComment("### Przebieg 12-1 zatrzymany")).toBe(false);
  });
});
