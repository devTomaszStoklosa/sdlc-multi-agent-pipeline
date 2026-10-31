import { describe, expect, it } from "vitest";
import { describeRoleJob } from "./role-output.ts";

const USAGE = { input_tokens: 0, output_tokens: 0, cost_usd: 0, turns: 0 };

describe("describeRoleJob", () => {
  it("names the cause of a failed stage", () => {
    expect(
      describeRoleJob({
        status: "done",
        role: "planner",
        runId: "1-1",
        attempts: 3,
        usage: USAGE,
        outcome: {
          kind: "failed",
          failure: "infra",
          message: "error_during_execution: --json-schema is invalid",
        },
      }),
    ).toBe(
      "done, failed (infra): error_during_execution: --json-schema is invalid",
    );
  });

  it("names the outcome of a stage that succeeded", () => {
    expect(
      describeRoleJob({
        status: "done",
        role: "planner",
        runId: "1-1",
        attempts: 1,
        usage: USAGE,
        outcome: { kind: "plan", version: 1, highImpact: false },
      }),
    ).toBe("done, plan");
  });

  it("gives the reason of a skipped job", () => {
    expect(
      describeRoleJob({
        status: "skipped",
        reason: "no planner stage of this workflow run",
      }),
    ).toBe("skipped (no planner stage of this workflow run)");
  });
});
