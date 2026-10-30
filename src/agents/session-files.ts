import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OrgBaseline } from "../config/schema.ts";
import { validateRepoConfig } from "../config/validate.ts";
import { createHookContext, hookContextSchema } from "../hooks/context.ts";
import type { Role } from "../hooks/roles.ts";
import { claudeSettings } from "./claude-settings.ts";

const HOOK_CLI = fileURLToPath(new URL("../hooks/cli.ts", import.meta.url));
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
];

export interface SessionSpec {
  role: Role;
  workspace: string;
  // The .sdlc-agents.yml text: a file of the repository, or the run's copy
  // (FR-10.5).
  configText: string;
  baseline: OrgBaseline;
  // The session directory, outside the workspace.
  out: string;
}

export interface SessionFiles {
  contextPath: string;
  settingsPath: string;
  auditLog: string;
}

export type SessionFilesResult =
  { ok: true; files: SessionFiles } | { ok: false; errors: string[] };

// Writes the hook context and the Claude Code settings of an agent session
// (plan 3.4). The directory must be outside the workspace, so the agent
// cannot change its own hooks.
export async function writeSessionFiles(
  spec: SessionSpec,
): Promise<SessionFilesResult> {
  const result = validateRepoConfig(spec.configText, spec.baseline);
  if (!result.ok) return result;
  const out = path.resolve(spec.out);
  const fromWorkspace = path.relative(path.resolve(spec.workspace), out);
  if (!fromWorkspace.startsWith("..") && !path.isAbsolute(fromWorkspace)) {
    throw new Error("The output directory must be outside the workspace.");
  }
  const auditLog = path.join(out, "audit", "tool-calls.jsonl");
  const context = hookContextSchema.parse(
    createHookContext(result.effective, {
      role: spec.role,
      workspace: spec.workspace,
      auditLog,
    }),
  );
  const contextPath = path.join(out, "hook-context.json");
  const settingsPath = path.join(out, "claude-settings.json");
  const settings = claudeSettings({
    hookCommand: [process.execPath, ...NODE_FLAGS, HOOK_CLI],
    contextPath,
    allowedHosts: context.rules.allowed_hosts,
  });
  await mkdir(out, { recursive: true });
  await writeFile(contextPath, JSON.stringify(context, null, 2));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
  return { ok: true, files: { contextPath, settingsPath, auditLog } };
}
