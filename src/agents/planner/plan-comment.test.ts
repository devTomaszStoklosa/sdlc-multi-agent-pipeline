import { describe, expect, it } from "vitest";
import { aPlan } from "./fixtures.ts";
import type { Classification } from "./high-impact.ts";
import {
  isPlanComment,
  latestPlan,
  parsePlanBlock,
  planComment,
  planEntries,
  planOf,
  planUpdateComment,
} from "./plan-comment.ts";
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

describe("planUpdateComment", () => {
  it("gives the reason, the new files and the whole file list (FR-4.11)", () => {
    const body = planUpdateComment({
      runId: "12-2",
      version: 4,
      reason: "Zmiana sygnatury.",
      changed: [{ path: "src/cart.ts", change: "modify", why: "Wywołanie." }],
      files: [
        ...aPlan().files,
        { path: "src/cart.ts", change: "modify", why: "Wywołanie." },
      ],
      classification: NORMAL,
      approvalLabel: "plan:approved",
    });
    expect(body).toMatch(
      /^### Aktualizacja planu, wersja 4 \(przebieg 12-2\)\n/,
    );
    expect(body).toContain("- ocena Developera: Jedna funkcja.");
    expect(body).toContain("#### Powód\n\nZmiana sygnatury.");
    expect(body).toContain("| `src/cart.ts` | modify | Wywołanie. |");
    expect(isPlanComment(body)).toBe(true);
    expect(parsePlanBlock(body)?.files.map((file) => file.path)).toEqual([
      "src/price.ts",
      "src/price.test.ts",
      "src/cart.ts",
    ]);
  });
});

describe("planEntries", () => {
  const APP = 7;
  const posted = (body: string, appId: number | undefined = APP) => ({
    id: 1,
    body,
    authorLogin: "app[bot]",
    appId,
    createdAt: "2026-10-30T10:00:00Z",
    updatedAt: "2026-10-30T10:00:00Z",
    url: `https://github.test/c/${body.length.toString()}`,
  });
  const plan = (runId: string, version: number) =>
    planComment({
      runId,
      version,
      plan: aPlan(),
      classification: NORMAL,
      approvalLabel: "plan:approved",
    });

  it("keeps only the app's plan comments with a valid block", () => {
    const entries = planEntries(
      [
        posted(plan("12-1", 1)),
        posted(plan("12-1", 2), 99),
        posted("### Plan, wersja 3\n\nBez bloku."),
        posted("Komentarz."),
      ],
      APP,
    );
    expect(entries.map((entry) => entry.block.version)).toEqual([1]);
  });

  it("finds a version of a run and the newest plan of the newest run", () => {
    const entries = planEntries(
      [
        posted(plan("12-1", 1)),
        posted(plan("12-1", 2)),
        posted(plan("12-2", 1)),
        posted(plan("12-10", 1)),
      ],
      APP,
    );
    expect(planOf(entries, "12-1", 2)?.block).toMatchObject({
      run: "12-1",
      version: 2,
    });
    expect(planOf(entries, "12-2", 2)).toBeUndefined();
    expect(latestPlan(entries)?.block.run).toBe("12-10");
    expect(latestPlan([])).toBeUndefined();
  });
});
