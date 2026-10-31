import { describe, expect, it } from "vitest";
import { configText } from "../../config/fixtures.ts";
import type { RoleInput } from "../role-runner.ts";
import { aBrief } from "./fixtures.ts";
import { developerPrompt } from "./prompt.ts";

const NONCE = "abc123";

function input(brief: RoleInput["brief"] = aBrief()): RoleInput {
  return {
    role: "developer",
    issue: { number: 12, title: "Rabat", body: "Dodaj rabat." },
    runId: "12-1",
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

describe("developerPrompt", () => {
  it("gives the facts of the stage and the plan as data", () => {
    const prompt = developerPrompt(input(), "# Developer", NONCE);
    expect(prompt.startsWith("# Developer\n\n## This run")).toBe(true);
    expect(prompt).toContain("You implement version 1 of the plan.");
    expect(prompt).toContain("the repository's main branch");
    expect(prompt).toContain(
      "The pipeline installed the dependencies with `npm ci`.",
    );
    expect(prompt).toContain(
      `<data-${NONCE} source="plan, version 1">\n### Plan, wersja 1 (przebieg 12-1)\n</data-${NONCE}>`,
    );
    expect(prompt).not.toContain("conflict");
    expect(prompt).not.toContain("gates failed");
  });

  it("adds the branch, the conflicts, the gate logs and the findings", () => {
    const prompt = developerPrompt(
      {
        ...input(
          aBrief({
            branch: "feat/12-rabat",
            conflicts: ["src/price.ts"],
            gateFailures: [{ job: "lint", log: "error: no-unused-vars" }],
          }),
        ),
        findings: ["f-1"],
      },
      "# Developer",
      NONCE,
    );
    expect(prompt).toContain("the run's branch `feat/12-rabat`");
    expect(prompt).toContain(
      "still conflict; resolve them first: `src/price.ts`.",
    );
    expect(prompt).toContain("The gates failed on your last push.");
    expect(prompt).toContain(
      `<data-${NONCE} source="log of the failed gate job lint">\nerror: no-unused-vars\n</data-${NONCE}>`,
    );
    expect(prompt).toContain("blocking findings: f-1.");
  });

  it("needs a brief", () => {
    const without = { ...input(), brief: undefined };
    expect(() => developerPrompt(without, "# D", NONCE)).toThrow(
      "needs a brief",
    );
  });
});
