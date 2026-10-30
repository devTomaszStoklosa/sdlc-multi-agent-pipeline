import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseYaml, type ParseResult } from "../config/parse.ts";
import { ROLES, type Role } from "../hooks/roles.ts";

const PROMPTS_DIR = new URL("../../prompts/", import.meta.url);

const roleSettingsSchema = z.strictObject({
  model: z.string().regex(/^claude-[a-z0-9-]+$/),
  // A file in the prompts directory.
  prompt: z.string().regex(/^[a-z0-9-]+\.md$/),
});

// prompts/roles.yml: the versioned model and prompt of each role (FR-5.8).
const rolesFileSchema = z.strictObject({
  version: z.literal(1),
  roles: z.partialRecord(z.enum(ROLES), roleSettingsSchema),
});

export type RolesFile = z.infer<typeof rolesFileSchema>;

export interface RoleSettings {
  model: string;
  // The text of the role's prompt.
  instructions: string;
}

export function parseRolesFile(text: string): ParseResult<RolesFile> {
  return parseYaml(text, rolesFileSchema);
}

// The model and prompt of a role. A role without an entry is a fault of this
// repository, so the job fails instead of running the role with a default.
export async function loadRoleSettings(role: Role): Promise<RoleSettings> {
  const text = await readFile(new URL("roles.yml", PROMPTS_DIR), "utf8");
  const parsed = parseRolesFile(text);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const settings = parsed.value.roles[role];
  if (settings === undefined) {
    throw new Error(`prompts/roles.yml has no entry for the ${role} role.`);
  }
  const instructions = await readFile(
    fileURLToPath(new URL(settings.prompt, PROMPTS_DIR)),
    "utf8",
  );
  return { model: settings.model, instructions };
}
