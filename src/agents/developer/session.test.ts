import { describe, expect, it } from "vitest";
import { configText } from "../../config/fixtures.ts";
import { aPlan } from "../planner/fixtures.ts";
import { planComment } from "../planner/plan-comment.ts";
import type { RoleInput } from "../role-runner.ts";
import { aBrief } from "./fixtures.ts";
import { developerSession } from "./session.ts";

function input(paths: string[]): RoleInput {
  const body = planComment({
    runId: "12-1",
    version: 1,
    plan: aPlan({
      files: paths.map((file) => ({ path: file, change: "modify", why: "x" })),
    }),
    classification: { highImpact: true, reasons: [] },
    approvalLabel: "plan:approved",
  });
  return {
    role: "developer",
    issue: { number: 12, title: "T", body: "B" },
    runId: "12-1",
    planVersion: 1,
    reviewRound: 0,
    pushes: 0,
    findings: [],
    attempt: 1,
    config: configText(),
    maxTurns: 30,
    brief: aBrief({
      plan: { version: 1, body, url: "https://github.test/issues/12#c-1" },
    }),
  };
}

describe("developerSession", () => {
  it("gives the hooks the dependency manifests of the plan", () => {
    const paths = ["src/cart.ts", "package.json", "web/package.json"];
    expect(developerSession.manifests?.(input(paths))).toEqual([
      "package.json",
      "web/package.json",
    ]);
  });

  it("gives none for a plan without a manifest or a brief", () => {
    expect(developerSession.manifests?.(input(["src/cart.ts"]))).toEqual([]);
    const withoutBrief = input(["package.json"]);
    delete withoutBrief.brief;
    expect(developerSession.manifests?.(withoutBrief)).toEqual([]);
  });
});
