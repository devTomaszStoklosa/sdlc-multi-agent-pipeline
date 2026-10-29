import type { HookContext } from "../context.ts";
import { matchesGlob, patternPath, resolvePath } from "../paths.ts";
import { toolPaths, type ToolCall, type ToolPolicy } from "../policy.ts";

// Characters that end a path in a command line, so `--env-file=.env` and
// `"$(cat .env)"` both yield `.env`.
const SEPARATORS = /[\s'"`;&|<>()=,]+/;

function fragments(text: string): string[] {
  return text.split(SEPARATORS).filter((fragment) => fragment !== "");
}

// Paths in a shell line, read both from the raw text and from the parsed
// words, which have their quotes and escapes removed.
function shellPaths(call: ToolCall): string[] {
  const words = call.commands.flatMap((command) => [
    ...command.words,
    ...command.inputs,
    ...command.outputs,
  ]);
  return [...fragments(call.line), ...words.flatMap(fragments)];
}

function candidates(call: ToolCall): string[] {
  // Grep's file filter names the files whose content it reads.
  const filter = call.input.glob;
  return [
    ...toolPaths(call),
    ...(typeof filter === "string" ? [filter] : []),
    ...shellPaths(call),
  ];
}

function isSecret(target: string, context: HookContext): boolean {
  const resolved = resolvePath(context.workspace, target);
  return matchesGlob(patternPath(resolved), context.rules.secret_paths);
}

// Agents may not read, print or change files that hold secrets, such as .env
// files and private keys (SEC-9.3). The patterns come from hooks.secret_paths.
export const secretFiles: ToolPolicy = {
  name: "secret-files",
  category: "secrets",
  check(call, context) {
    const found = candidates(call).find((target) => isSecret(target, context));
    if (found === undefined) return undefined;
    return `${found} may hold secrets, so agents may not access it.`;
  },
};
