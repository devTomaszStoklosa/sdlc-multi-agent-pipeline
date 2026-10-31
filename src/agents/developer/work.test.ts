import { describe, expect, it } from "vitest";
import { aWork } from "./fixtures.ts";
import { workJsonSchema, workSchema } from "./work.ts";

describe("workSchema", () => {
  it("accepts a work result with a plan update", () => {
    const work = aWork({
      planUpdate: {
        reason: "Zmiana sygnatury wymaga poprawy wywołań.",
        files: [{ path: "src/cart.ts", change: "modify", why: "Wywołanie." }],
        highImpact: { value: false, reasons: ["Jeden plik więcej."] },
      },
    });
    expect(workSchema.safeParse(work).success).toBe(true);
  });

  it.each([
    [
      "a multi-line subject",
      aWork({ commit: { type: "feat", subject: "a\nb" } }),
    ],
    [
      "a scope with spaces",
      aWork({ commit: { type: "fix", scope: "a b", subject: "fix it" } }),
    ],
    [
      "an unknown commit type",
      { ...aWork(), commit: { type: "wip", subject: "x" } },
    ],
    ["an empty summary", aWork({ summary: " " })],
    [
      "too many issues out of scope",
      aWork({
        outOfScope: Array.from({ length: 6 }, () => ({
          title: "T",
          body: "B",
        })),
      }),
    ],
    [
      "a plan update with a path outside the repository",
      aWork({
        planUpdate: {
          reason: "R",
          files: [{ path: "../x.ts", change: "add", why: "W" }],
          highImpact: { value: false, reasons: [] },
        },
      }),
    ],
    [
      "a high-impact plan update without a reason",
      aWork({
        planUpdate: {
          reason: "R",
          files: [{ path: "package.json", change: "modify", why: "W" }],
          highImpact: { value: true, reasons: [] },
        },
      }),
    ],
  ])("rejects %s", (_name, work) => {
    expect(workSchema.safeParse(work).success).toBe(false);
  });

  // Claude Code accepts only draft-07 schemas for --json-schema (plan 3.4).
  it("gives the session a draft-07 JSON Schema", () => {
    expect(workJsonSchema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      required: ["commit", "summary", "outOfScope"],
    });
  });
});
