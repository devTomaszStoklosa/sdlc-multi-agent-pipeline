import type { ToolPolicy } from "../policy.ts";
import { gitInvocations, hasShortFlag } from "../shell/git.ts";
import { invocations, type SimpleCommand } from "../shell/parse.ts";

// Variables that make lefthook, husky or pre-commit skip the hooks.
const SKIP_VARIABLES = /^(LEFTHOOK|LEFTHOOK_EXCLUDE|LEFTHOOK_SKIP|HUSKY|SKIP)=/;
const LEFTHOOK = new Set(["lefthook"]);

function skipsWithFlag(command: SimpleCommand): boolean {
  return gitInvocations(command).some(
    ({ subcommand, args }) =>
      args.includes("--no-verify") ||
      (subcommand === "commit" && hasShortFlag(args, "n")),
  );
}

function skipsWithVariable(command: SimpleCommand): boolean {
  return [...command.assignments, ...command.words].some((word) =>
    SKIP_VARIABLES.test(word),
  );
}

function uninstallsHooks(command: SimpleCommand): boolean {
  return invocations(command, LEFTHOOK).some((args) =>
    args.includes("uninstall"),
  );
}

// Git hooks are the same for people and agents (QG-9.15), so an agent may not
// skip them: no `--no-verify`, no other hooks path and no skip variables
// (SEC-9.6).
export const skipGitHooks: ToolPolicy = {
  name: "skip-git-hooks",
  category: "role",
  check(call) {
    const skips =
      /core\.hooksPath/i.test(call.line) ||
      call.commands.some(
        (command) =>
          skipsWithFlag(command) ||
          skipsWithVariable(command) ||
          uninstallsHooks(command),
      );
    if (!skips) return undefined;
    return "Agents may not skip or change the git hooks.";
  },
};
