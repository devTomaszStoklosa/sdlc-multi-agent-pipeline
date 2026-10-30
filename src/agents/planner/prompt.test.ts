import { describe, expect, it } from "vitest";
import { configText } from "../../config/fixtures.ts";
import type { RoleInput } from "../role-runner.ts";
import { plannerPrompt } from "./prompt.ts";

const NONCE = "abc123";

function input(brief?: RoleInput["brief"]): RoleInput {
  return {
    role: "planner",
    issue: { number: 12, title: "Rabat", body: "Dodaj rabat." },
    runId: "12-2",
    planVersion: 1,
    reviewRound: 0,
    pushes: 0,
    findings: [],
    attempt: 1,
    config: configText(),
    maxTurns: 50,
    brief,
  };
}

describe("plannerPrompt", () => {
  it("puts the instructions first and the issue in data tags", () => {
    const prompt = plannerPrompt(input(), "# Planner", NONCE);
    expect(prompt.startsWith("# Planner\n\n## This run")).toBe(true);
    expect(prompt).toContain("You write version 2 of the plan.");
    expect(prompt).toContain(
      `<data-${NONCE} source="issue body">\nDodaj rabat.\n</data-${NONCE}>`,
    );
  });

  it("adds the brief of a run after a stop", () => {
    const prompt = plannerPrompt(
      input({
        kind: "planner",
        comments: [
          {
            author: "author",
            at: "2026-10-29T10:00:00Z",
            body: "Bez nowych zależności.",
          },
        ],
        previousPlans: [
          { at: "2026-10-28T10:00:00Z", body: "### Plan, wersja 1" },
        ],
        stopSummary: "### Przebieg 12-1 zatrzymany",
        branchDiff: {
          branch: "feat/12-rabat",
          base: "main",
          files: [
            {
              path: "src/a.ts",
              additions: 3,
              deletions: 1,
              patch: "@@ -1 +1 @@",
            },
            { path: "logo.png", additions: 0, deletions: 0 },
          ],
        },
      }),
      "# Planner",
      NONCE,
    );
    for (const source of [
      "comment by author at 2026-10-29T10:00:00Z",
      "earlier plan version posted at 2026-10-28T10:00:00Z",
      "stop summary of the previous run",
      "diff of branch feat/12-rabat against main",
    ]) {
      expect(prompt).toContain(`<data-${NONCE} source="${source}">`);
    }
    expect(prompt).toContain("--- src/a.ts (+3 -1)\n@@ -1 +1 @@");
    expect(prompt).toContain("(no patch: the file is large or binary)");
  });

  it("truncates a long issue body", () => {
    const long = input();
    long.issue.body = "x".repeat(30_000);
    expect(plannerPrompt(long, "# Planner", NONCE)).toContain(
      "\n[... truncated]",
    );
  });
});
