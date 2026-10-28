import lint from "@commitlint/lint";
import load from "@commitlint/load";
import { describe, expect, it } from "vitest";

const config = await load({}, { cwd: `${import.meta.dirname}/..` });
const options: Parameters<typeof lint>[2] = config.parserPreset
  ? { parserOpts: config.parserPreset.parserOpts as object }
  : {};

async function isValid(message: string): Promise<boolean> {
  const result = await lint(message, config.rules, options);
  return result.valid;
}

describe("commitlint config", () => {
  it.each([
    "docs: describe the quality gates (#15)",
    "feat: add the run store\n\nRefs #3",
    "chore: set up the pipeline skeleton\n\nCloses #25",
  ])("accepts %j", async (message) => {
    expect(await isValid(message)).toBe(true);
  });

  it.each([
    ["no type", "update the docs (#15)"],
    ["no issue reference", "feat: add the run store"],
  ])("rejects a message with %s", async (_reason, message) => {
    expect(await isValid(message)).toBe(false);
  });
});
