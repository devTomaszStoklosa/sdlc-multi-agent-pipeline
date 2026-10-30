import { describe, expect, it } from "vitest";
import { aPlan } from "./fixtures.ts";
import { isRepositoryPath, planJsonSchema, planSchema } from "./plan.ts";

describe("planSchema", () => {
  it("accepts a plan with every element of FR-4.3", () => {
    expect(planSchema.safeParse(aPlan()).success).toBe(true);
  });

  it.each([
    ["no acceptance criteria", { acceptance: [] }],
    ["no files", { files: [] }],
    ["an empty summary", { summary: "  " }],
    [
      "a criterion over two lines",
      {
        acceptance: [{ criterion: "a\nb", how: "c" }],
      },
    ],
    [
      "a repeated file",
      {
        files: [
          { path: "a.ts", change: "add" as const, why: "x" },
          { path: "a.ts", change: "add" as const, why: "y" },
        ],
      },
    ],
    ["a negative estimate", { estimatedChangedLines: -1 }],
    [
      "high-impact without a reason",
      {
        highImpact: { value: true, reasons: [] },
      },
    ],
  ])("rejects %s", (_name, overrides) => {
    expect(planSchema.safeParse(aPlan(overrides)).success).toBe(false);
  });

  it("gives the session a JSON Schema without limits it may not support", () => {
    const text = JSON.stringify(planJsonSchema);
    expect(planJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(text).not.toMatch(/maxLength|minLength|pattern|minItems/);
  });
});

describe("isRepositoryPath", () => {
  it.each(["src/a.ts", ".github/workflows/ci.yml", "a"])("accepts %s", (p) => {
    expect(isRepositoryPath(p)).toBe(true);
  });

  it.each(["/etc/passwd", "../a", "src/../../a", "src//a", "a\\b", "./a"])(
    "rejects %s",
    (p) => {
      expect(isRepositoryPath(p)).toBe(false);
    },
  );
});
