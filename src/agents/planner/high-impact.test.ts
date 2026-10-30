import { describe, expect, it } from "vitest";
import { aPlan } from "./fixtures.ts";
import { changeFacts, classify, type HighImpactPolicy } from "./high-impact.ts";
import type { Plan } from "./plan.ts";

const POLICY: HighImpactPolicy = {
  max_files: 10,
  max_changed_lines: 400,
  extra_paths: ["src/auth/**"],
};

function withFiles(...paths: string[]): Plan {
  return aPlan({
    files: paths.map((path) => ({ path, change: "modify", why: "x" })),
  });
}

function ruleReasons(plan: Plan, branch = changeFacts(plan)) {
  const result = classify(plan, branch, POLICY);
  return {
    highImpact: result.highImpact,
    rules: result.reasons
      .filter((reason) => reason.source === "rule")
      .map((reason) => reason.text),
  };
}

describe("classify", () => {
  it("keeps a small change without risky files normal", () => {
    expect(ruleReasons(aPlan())).toEqual({ highImpact: false, rules: [] });
  });

  it.each([
    ["a new dependency", "package.json", "zależności"],
    ["a nested lockfile", "web/pnpm-lock.yaml", "zależności"],
    ["a workflow", ".github/workflows/gates.yml", "CI"],
    [".sdlc-agents.yml", ".sdlc-agents.yml", "CI"],
    ["a gate configuration", "eslint.config.js", "bramek"],
    ["an extra path of the configuration", "src/auth/login.ts", "extra_paths"],
  ])("marks %s as high-impact", (_name, path, reason) => {
    const result = ruleReasons(withFiles("src/a.ts", path));
    expect(result.highImpact).toBe(true);
    expect(result.rules).toEqual([expect.stringContaining(reason)]);
    expect(result.rules[0]).toContain(`\`${path}\``);
  });

  it("marks more files or lines than the limits as high-impact", () => {
    const many = withFiles(
      ...Array.from({ length: 11 }, (_, i) => `f${String(i)}.ts`),
    );
    expect(ruleReasons(many).rules).toEqual([
      expect.stringContaining("max_files"),
    ]);
    expect(ruleReasons(aPlan({ estimatedChangedLines: 401 })).rules).toEqual([
      expect.stringContaining("max_changed_lines"),
    ]);
    expect(ruleReasons(aPlan({ estimatedChangedLines: 400 })).highImpact).toBe(
      false,
    );
  });

  it("counts the files and lines of the branch an earlier run left", () => {
    const facts = changeFacts(aPlan({ estimatedChangedLines: 100 }), [
      { path: "package.json", additions: 250, deletions: 60 },
    ]);
    expect(facts.changedLines).toBe(410);
    expect(ruleReasons(aPlan(), facts).rules).toHaveLength(2);
  });

  it("follows the model when it alone sees a high-impact change", () => {
    const plan = aPlan({
      highImpact: { value: true, reasons: ["Zmienia publiczne API."] },
    });
    expect(classify(plan, changeFacts(plan), POLICY)).toEqual({
      highImpact: true,
      reasons: [{ source: "model", text: "Zmienia publiczne API." }],
    });
  });
});
