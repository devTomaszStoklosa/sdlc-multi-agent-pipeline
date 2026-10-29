import type { HookContext } from "../context.ts";
import { resolvePath } from "../paths.ts";
import type { ToolPolicy } from "../policy.ts";
import { invocations, type SimpleCommand } from "../shell/parse.ts";

const RM = new Set(["rm"]);

function isRecursive(args: readonly string[]): boolean {
  return args.some(
    (arg) => arg === "--recursive" || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(arg),
  );
}

// Recursive removal of the workspace itself, of its git history or of
// anything outside it.
function removesTooMuch(args: readonly string[], workspace: string): boolean {
  return args
    .filter((arg) => !arg.startsWith("-"))
    .some((target) => {
      const { inside, relative } = resolvePath(workspace, target);
      return !inside || relative === "" || /^\.git(\/|$)/.test(relative);
    });
}

// Each command is matched from every word on, so `sudo git rebase` and
// `xargs dropdb` match patterns anchored at the program name.
function matchesPattern(
  command: SimpleCommand,
  patterns: readonly RegExp[],
): RegExp | undefined {
  const starts = command.words.map((_word, index) =>
    command.words.slice(index).join(" "),
  );
  return patterns.find((pattern) => starts.some((text) => pattern.test(text)));
}

function problem(
  command: SimpleCommand,
  context: HookContext,
): string | undefined {
  const removal = invocations(command, RM).some(
    (args) => isRecursive(args) && removesTooMuch(args, context.workspace),
  );
  if (removal) return "recursive removal outside the workspace files";
  const patterns = context.rules.destructive_commands.map(
    (source) => new RegExp(source, "i"),
  );
  const pattern = matchesPattern(command, patterns);
  return pattern === undefined ? undefined : `pattern ${pattern.source}`;
}

// Agents may not run destructive commands: rewriting git history, dropping
// databases or removing files outside the workspace (SEC-9.5). The patterns
// come from hooks.destructive_commands.
export const destructiveCommands: ToolPolicy = {
  name: "destructive-commands",
  category: "destructive",
  check(call, context) {
    for (const command of call.commands) {
      const found = problem(command, context);
      if (found !== undefined) {
        return `Agents may not run destructive commands: ${found}.`;
      }
    }
    return undefined;
  },
};
