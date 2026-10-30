import { describe, expect, it } from "vitest";
import { loadRoleSettings, parseRolesFile } from "./roles-config.ts";

describe("prompts/roles.yml", () => {
  it("gives the Planner its model and prompt", async () => {
    const settings = await loadRoleSettings("planner");
    expect(settings.model).toBe("claude-sonnet-5-5");
    expect(settings.instructions).toContain("# Planner");
  });

  it("fails for a role without an entry", async () => {
    await expect(loadRoleSettings("reviewer")).rejects.toThrow(
      "no entry for the reviewer role",
    );
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
});
