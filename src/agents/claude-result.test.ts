import { describe, expect, it } from "vitest";
import { toRoleResult } from "./claude-result.ts";

const USAGE = {
  input_tokens: 10,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 1000,
  output_tokens: 50,
};

function cli(fields: Record<string, unknown>, exitCode = 0) {
  return {
    exitCode,
    stdout: JSON.stringify({
      type: "result",
      num_turns: 4,
      total_cost_usd: 0.12,
      usage: USAGE,
      ...fields,
    }),
    stderr: "",
  };
}

const wrap = (structured: unknown) => ({ role: "planner", plan: structured });

describe("toRoleResult", () => {
  it("turns the structured output into the role output with its usage", () => {
    const result = toRoleResult(
      cli({ subtype: "success", is_error: false, structured_output: { a: 1 } }),
      wrap,
    );
    expect(result).toEqual({
      status: "ok",
      output: { role: "planner", plan: { a: 1 } },
      usage: {
        input_tokens: 1110,
        output_tokens: 50,
        cost_usd: 0.12,
        turns: 4,
      },
    });
  });

  it("reports the turn limit", () => {
    expect(
      toRoleResult(
        cli({ subtype: "error_max_turns", is_error: true }, 1),
        wrap,
      ),
    ).toMatchObject({ status: "failed", failure: "max-turns" });
  });

  it("reports the plan's usage limit with its reset time", () => {
    const result = toRoleResult(
      cli({
        subtype: "success",
        is_error: true,
        result: "Claude AI usage limit reached|1793360000",
      }),
      wrap,
    );
    expect(result).toMatchObject({
      status: "failed",
      failure: "usage-limit",
      resetsAt: new Date(1_793_360_000_000).toISOString(),
    });
  });

  it("reports other errors as infrastructure errors without secrets", () => {
    const token = `sk-ant-oat01-${"x".repeat(40)}`;
    const result = toRoleResult(
      cli({ subtype: "error_during_execution", is_error: true, result: token }),
      wrap,
    );
    expect(result).toMatchObject({ status: "failed", failure: "infra" });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("fails a session without structured output", () => {
    expect(
      toRoleResult(cli({ subtype: "success", is_error: false }), wrap),
    ).toMatchObject({
      status: "failed",
      failure: "infra",
      message:
        "The session returned no structured output (result keys: is_error, num_turns, subtype, total_cost_usd, type, usage).",
    });
  });

  it("fails a process that printed no result", () => {
    const result = toRoleResult(
      { exitCode: 127, stdout: "", stderr: "claude: not found" },
      wrap,
    );
    expect(result).toMatchObject({
      status: "failed",
      failure: "infra",
      usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0, turns: 0 },
    });
    expect(JSON.stringify(result)).toContain("code 127");
  });
});
