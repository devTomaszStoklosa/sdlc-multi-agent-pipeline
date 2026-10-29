import { describe, expect, it } from "vitest";
import { BASELINE, configText } from "./fixtures.ts";
import { validateRepoConfig } from "./validate.ts";

describe("validateRepoConfig", () => {
  it("returns the configuration and its effective values", () => {
    const result = validateRepoConfig(
      configText({ limits: { max_minutes_per_run: 30 } }),
      BASELINE,
    );
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.config.limits.max_minutes_per_run).toBe(30);
    expect(result.config.review).toBeUndefined();
    expect(result.effective.limits.max_minutes_per_run).toBe(30);
    expect(result.effective.review.max_rounds).toBe(3);
  });

  it("reports schema errors", () => {
    const result = validateRepoConfig(configText({ version: 2 }), BASELINE);
    expect(result.ok).toBe(false);
  });

  it("reports every field that loosens the baseline (FR-10.2)", () => {
    const result = validateRepoConfig(
      configText({
        gates: { sast_fail_on: "critical" },
        limits: { max_minutes_per_run: 46 },
      }),
      BASELINE,
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        'gates.sast_fail_on: "critical" is looser than the organization baseline "high"',
        "limits.max_minutes_per_run: 46 is looser than the organization baseline 45",
      ],
    });
  });
});
