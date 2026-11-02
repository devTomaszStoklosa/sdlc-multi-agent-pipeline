import { describe, expect, it } from "vitest";
import { checkCoverage, linePct } from "./coverage.ts";

describe("linePct", () => {
  it("reads the total line coverage of a json-summary report", () => {
    const report = JSON.stringify({
      total: { lines: { total: 10, covered: 8, pct: 80 } },
    });
    expect(linePct(report)).toBe(80);
  });

  it("rejects a report in another format", () => {
    expect(() => linePct(JSON.stringify({ lines: 80 }))).toThrow();
  });
});

describe("checkCoverage", () => {
  it("passes a drop within the tolerance", () => {
    expect(checkCoverage(80, 79.5, 0.5)).toEqual({
      passed: true,
      message: "Line coverage: base 80%, head 79.5%, allowed drop 0.5 pp.",
    });
  });

  it("fails a drop beyond the tolerance", () => {
    expect(checkCoverage(80, 79.9, 0).passed).toBe(false);
  });

  it("passes when the base has no coverage", () => {
    expect(checkCoverage(undefined, 50, 0)).toEqual({
      passed: true,
      message: "No base coverage to compare with. Head line coverage: 50%.",
    });
  });
});
