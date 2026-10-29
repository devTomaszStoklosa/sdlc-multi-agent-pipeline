import { invocations, type SimpleCommand } from "./parse.ts";

export interface GitInvocation {
  // Undefined for a bare `git` or `git --version`.
  subcommand: string | undefined;
  args: string[];
}

const GIT = new Set(["git"]);
// Global options that take their value as the next word.
const OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);

function split(args: readonly string[]): GitInvocation {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (OPTIONS_WITH_VALUE.has(arg)) index += 1;
    else if (!arg.startsWith("-")) {
      return { subcommand: arg, args: args.slice(index + 1) };
    }
  }
  return { subcommand: undefined, args: [] };
}

export function gitInvocations(command: SimpleCommand): GitInvocation[] {
  return invocations(command, GIT).map(split);
}

// Whether an argument is a short option cluster with the letter, as `-am`.
export function hasShortFlag(args: readonly string[], flag: string): boolean {
  return args.some((arg) => /^-[a-zA-Z]+$/.test(arg) && arg.includes(flag));
}
