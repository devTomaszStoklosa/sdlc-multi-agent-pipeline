import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { LOCKFILES } from "../../core/dependency-files.ts";
import { SANDBOX_PLACEHOLDERS } from "../../git/sandbox-placeholders.ts";
import type { HookContext } from "../context.ts";
import type { PostToolUseEvent } from "../events.ts";
import { matchesGlob, patternPath, resolvePath } from "../paths.ts";
import { isWriteTool, toolPaths, toToolCall } from "../policy.ts";
import { failedChecks, type HookDependencies } from "./dependencies.ts";

// The sandbox's mount points that are lockfiles of other package managers. A
// package manager may fill such an empty file next to its own lockfile, so it
// goes before the install; the sandbox makes it again for its next command.
const LOCKFILE_PLACEHOLDERS = SANDBOX_PLACEHOLDERS.filter((file) =>
  matchesGlob(file, LOCKFILES),
);

export async function removeLockfilePlaceholders(
  workspace: string,
): Promise<void> {
  for (const file of LOCKFILE_PLACEHOLDERS) {
    const full = path.join(workspace, file);
    try {
      const stats = await lstat(full);
      if (stats.isFile() && stats.size === 0) await rm(full);
    } catch {
      // The sandbox has not made this one.
    }
  }
}

// What the install tells the agent: a note after it ran, the problem after
// it failed.
export type Install =
  | { kind: "none" }
  | { kind: "installed"; note: string }
  | { kind: "failed"; problem: string };

// Installs the dependencies after a write to a dependency manifest of the
// plan, which also updates the lockfile (#49). The session cannot do it
// itself, because the sandbox keeps `node_modules/.bin` and the lockfiles
// read-only for its commands. The install runs in bubblewrap with the
// network, like the install before the session (plan 3.4).
export async function installPlannedDependencies(
  event: PostToolUseEvent,
  context: HookContext,
  dependencies: HookDependencies,
): Promise<Install> {
  const planned = context.dependencies;
  if (planned === undefined || !isWriteTool(event.tool_name)) {
    return { kind: "none" };
  }
  const written = toolPaths(toToolCall(event.tool_name, event.tool_input)).map(
    (file) => patternPath(resolvePath(context.workspace, file)),
  );
  const manifests = planned.manifests.filter((file) => written.includes(file));
  if (manifests.length === 0) return { kind: "none" };
  await removeLockfilePlaceholders(context.workspace);
  const [problem] = await failedChecks(
    dependencies.installer,
    [["dependency install", planned.command]],
    [],
  );
  if (problem !== undefined) return { kind: "failed", problem };
  return {
    kind: "installed",
    note: `The pipeline installed the dependencies of ${manifests.join(", ")} and updated the lockfile.`,
  };
}
