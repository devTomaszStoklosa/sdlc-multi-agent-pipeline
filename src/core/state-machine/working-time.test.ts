import { describe, expect, it } from "vitest";
import { workingMinutes } from "./working-time.ts";

describe("workingMinutes", () => {
  it("counts only the time in working states (NFR-11.5)", () => {
    const history = [
      { state: "queued", at: "2026-10-29T10:00:00Z" },
      { state: "planning", at: "2026-10-29T10:05:00Z" },
      { state: "awaiting-plan-approval", at: "2026-10-29T10:15:00Z" },
      { state: "developing", at: "2026-10-29T12:00:00Z" },
    ] as const;
    expect(workingMinutes(history, new Date("2026-10-29T12:20:00Z"))).toBe(30);
  });

  it("is zero without working states", () => {
    const history = [{ state: "queued", at: "2026-10-29T10:00:00Z" }] as const;
    expect(workingMinutes(history, new Date("2026-10-29T11:00:00Z"))).toBe(0);
  });
});
