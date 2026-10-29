import type { ToolPolicy } from "../policy.ts";
import { destructiveCommands } from "./destructive-commands.ts";
import { environmentSecrets } from "./environment-secrets.ts";
import { gitPush } from "./git-push.ts";
import { githubCli } from "./github-cli.ts";
import { network } from "./network.ts";
import { roleTools } from "./role-tools.ts";
import { secretFiles } from "./secret-files.ts";
import { skipGitHooks } from "./skip-git-hooks.ts";
import { workspaceWrites } from "./workspace-writes.ts";

// The organization's base set of PreToolUse policies (SEC-9.0b). A repository
// tightens them through its configuration, by adding paths and patterns.
export const BASE_POLICIES: readonly ToolPolicy[] = [
  roleTools,
  workspaceWrites,
  gitPush,
  secretFiles,
  environmentSecrets,
  network,
  destructiveCommands,
  skipGitHooks,
  githubCli,
];
