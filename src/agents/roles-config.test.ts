import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadRoleSettings, parseRolesFile } from "./roles-config.ts";

describe("prompts/roles.yml", () => {
  it("gives the Planner its model and prompt", async () => {
    const settings = await loadRoleSettings("planner");
    expect(settings.model).toBe("claude-sonnet-5-5");
    expect(settings.instructions).toContain("# Planner");
  });

  it("gives the Reviewer another model than the Developer (FR-5.5)", async () => {
    const reviewer = await loadRoleSettings("reviewer");
    const developer = await loadRoleSettings("developer");
    expect(reviewer.model).toBe("claude-opus-5-5");
    expect(reviewer.model).not.toBe(developer.model);
    expect(reviewer.instructions).toContain("# Reviewer");
  });

  it("is valid as committed", async () => {
    const text = await readFile(
      new URL("../../prompts/roles.yml", import.meta.url),
      "utf8",
    );
    expect(parseRolesFile(text)).toMatchObject({ ok: true });
  });

  it("rejects an unknown role, a model outside Claude and a prompt outside the directory", () => {
    const text = (entry: string) => `version: 1\nroles:\n${entry}\n`;
    expect(
      parseRolesFile(text("  devops:\n    model: claude-x\n    prompt: a.md")),
    ).toMatchObject({ ok: false });
    expect(
      parseRolesFile(text("  planner:\n    model: gpt-5\n    prompt: a.md")),
    ).toMatchObject({ ok: false });
    expect(
      parseRolesFile(
        text("  planner:\n    model: claude-x\n    prompt: ../secret.md"),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseRolesFile(text("  planner:\n    model: claude-x\n    prompt: a.md")),
    ).toMatchObject({ ok: true });
  });

  it("rejects a Reviewer on the Developer's model (FR-5.5)", () => {
    const text = (reviewerModel: string) =>
      [
        "version: 1",
        "roles:",
        "  developer:",
        "    model: claude-sonnet-5-5",
        "    prompt: developer.md",
        "  reviewer:",
        `    model: ${reviewerModel}`,
        "    prompt: reviewer.md",
      ].join("\n");
    expect(parseRolesFile(text("claude-sonnet-5-5"))).toEqual({
      ok: false,
      errors: [
        "roles.reviewer.model: The Reviewer needs another model than the Developer (FR-5.5).",
      ],
    });
    expect(parseRolesFile(text("claude-opus-5-5"))).toMatchObject({
      ok: true,
    });
  });
});
