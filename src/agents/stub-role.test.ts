import { describe, expect, it } from "vitest";
import type { Role } from "../hooks/roles.ts";
import { roleResultSchema, type RoleInput } from "./role-runner.ts";
import { StubRoleRunner } from "./stub-role.ts";

function input(
  role: Role,
  body: string,
  rest: Partial<RoleInput> = {},
): RoleInput {
  return {
    role,
    issue: { number: 12, title: "Test", body },
    runId: "12-1",
    planVersion: 0,
    reviewRound: 1,
    pushes: 0,
    findings: [],
    attempt: 1,
    config: "",
    maxTurns: 50,
    ...rest,
  };
}

function scenario(yaml: string): string {
  return `Opis issue.\n\n<!-- sdlc-stub\n${yaml}\n-->\n`;
}

const waits: number[] = [];
const runner = new StubRoleRunner((ms) => {
  waits.push(ms);
  return Promise.resolve();
});

async function run(given: RoleInput) {
  const result = await runner.run(given, new AbortController().signal);
  return roleResultSchema.parse(result);
}

describe("StubRoleRunner", () => {
  it("defaults to a normal plan, a passing push and approve", async () => {
    expect(await run(input("planner", ""))).toMatchObject({
      status: "ok",
      output: { plan: { highImpact: { value: false } } },
    });
    const push = await run(input("developer", ""));
    expect(push).toMatchObject({
      output: { change: { kind: "push", path: "stub-runs/issue-12.json" } },
    });
    expect(await run(input("reviewer", ""))).toMatchObject({
      output: { verdict: "approve", findings: [] },
    });
  });

  it("follows the plan kinds by version", async () => {
    const body = scenario("plans: [high-impact, normal]");
    const first = await run(input("planner", body));
    const second = await run(input("planner", body, { planVersion: 1 }));
    expect(first).toMatchObject({
      output: { plan: { highImpact: { value: true } } },
    });
    expect(second).toMatchObject({
      output: { plan: { highImpact: { value: false } } },
    });
  });

  it("writes unformatted JSON for a push that fails the gates", async () => {
    const body = scenario("gates: [fail, pass]");
    const failing = await run(input("developer", body));
    const passing = await run(input("developer", body, { pushes: 1 }));
    expect(failing).toMatchObject({
      output: { change: { content: '{"run":"12-1","push":1}' } },
    });
    expect(passing).toMatchObject({
      output: { change: { content: '{\n  "run": "12-1",\n  "push": 2\n}\n' } },
    });
  });

  it("updates the first plan before the first push", async () => {
    const body = scenario("plan_update: high-impact");
    const update = await run(input("developer", body, { planVersion: 1 }));
    expect(update).toMatchObject({
      output: { change: { kind: "plan-update", highImpact: true } },
    });
    const later = await run(input("developer", body, { planVersion: 2 }));
    expect(later).toMatchObject({ output: { change: { kind: "push" } } });
  });

  it("returns the verdicts by round, with new or repeated findings", async () => {
    const body = scenario("verdicts: [changes_requested, approve]");
    const first = await run(input("reviewer", body));
    expect(first).toMatchObject({
      output: {
        verdict: "changes_requested",
        findings: [{ id: "stub-finding-1", blocking: true }],
      },
    });
    const second = await run(input("reviewer", body, { reviewRound: 2 }));
    expect(second).toMatchObject({ output: { verdict: "approve" } });
    const repeated = scenario(
      "verdicts: [changes_requested]\nrepeat_finding: true",
    );
    const again = await run(input("reviewer", repeated, { reviewRound: 3 }));
    expect(again).toMatchObject({
      output: { findings: [{ id: "stub-finding" }] },
    });
  });

  it("fails the attempts listed for a role", async () => {
    const body = scenario("failures:\n  planner: [infra, usage-limit]");
    expect(await run(input("planner", body))).toMatchObject({
      status: "failed",
      failure: "infra",
    });
    const limited = await run(input("planner", body, { attempt: 2 }));
    expect(limited).toMatchObject({ status: "failed", failure: "usage-limit" });
    expect(limited.status === "failed" && limited.resetsAt).toBeTruthy();
    expect(await run(input("planner", body, { attempt: 3 }))).toMatchObject({
      status: "ok",
    });
  });

  it("waits as long as the scenario says", async () => {
    waits.length = 0;
    await run(input("developer", scenario("delay_seconds:\n  developer: 90")));
    expect(waits).toEqual([90_000]);
  });

  it("fails with an infrastructure error on an invalid scenario", async () => {
    const result = await run(input("planner", scenario("plans: [sometimes]")));
    expect(result).toMatchObject({ status: "failed", failure: "infra" });
  });
});
