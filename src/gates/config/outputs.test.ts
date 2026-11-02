import { describe, expect, it } from "vitest";
import { BASELINE, configText } from "../../config/fixtures.ts";
import { validateRepoConfig } from "../../config/validate.ts";
import { formatOutputs, gateOutputs } from "./outputs.ts";

function effective(sections: Record<string, unknown> = {}) {
  const result = validateRepoConfig(configText(sections), BASELINE);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.effective;
}

describe("gateOutputs", () => {
  it("takes the baseline thresholds when the repository sets none", () => {
    expect(gateOutputs(effective())).toEqual({
      install: "npm ci",
      build: "",
      test: "npm test",
      lint: "npm run lint",
      format: "npm run format",
      coverage: "",
      sast_fail_on: "high",
      dependency_scan_fail_on: "high",
      coverage_drop_tolerance: "0",
      max_duplication_percent: "3",
      environment:
        "SDLC_STATIC_ANALYSIS_FAIL_ON=error\nSDLC_MAX_FUNCTION_COMPLEXITY=10",
    });
  });

  it("takes the thresholds that the repository tightens", () => {
    const outputs = gateOutputs(
      effective({
        gates: {
          static_analysis_fail_on: "warning",
          sast_fail_on: "medium",
          dependency_scan_fail_on: "low",
          max_function_complexity: 8,
          max_duplication_percent: 2.5,
        },
      }),
    );
    expect(outputs).toMatchObject({
      sast_fail_on: "medium",
      dependency_scan_fail_on: "low",
      max_duplication_percent: "2.5",
      environment:
        "SDLC_STATIC_ANALYSIS_FAIL_ON=warning\nSDLC_MAX_FUNCTION_COMPLEXITY=8",
    });
  });

  it("passes the optional commands that the repository sets", () => {
    const outputs = gateOutputs(
      effective({
        commands: {
          install: "npm ci",
          test: "npm test",
          lint: "npm run lint",
          format: "npm run format",
          build: "npm run typecheck",
          coverage: "npm run coverage",
        },
      }),
    );
    expect(outputs).toMatchObject({
      build: "npm run typecheck",
      coverage: "npm run coverage",
    });
  });
});

describe("formatOutputs", () => {
  it("writes each output as a multiline block", () => {
    expect(
      formatOutputs({ lint: "npm run lint", env: "A=1\nB=2" }, "EOF_x"),
    ).toBe("lint<<EOF_x\nnpm run lint\nEOF_x\nenv<<EOF_x\nA=1\nB=2\nEOF_x\n");
  });

  it("refuses a value with the delimiter", () => {
    expect(() =>
      formatOutputs({ lint: "echo EOF_x\nbuild=evil" }, "EOF_x"),
    ).toThrow("The output lint contains the delimiter.");
  });
});
