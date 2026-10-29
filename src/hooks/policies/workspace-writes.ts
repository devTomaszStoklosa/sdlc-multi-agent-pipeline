import type { HookContext } from "../context.ts";
import { matchesGlob, patternPath, resolvePath } from "../paths.ts";
import {
  isWriteTool,
  toolPaths,
  type ToolCall,
  type ToolPolicy,
} from "../policy.ts";
import { invocations, type SimpleCommand } from "../shell/parse.ts";

// Programs that write to every path among their arguments.
const WRITE_EVERY_ARGUMENT = new Set([
  "tee",
  "touch",
  "mkdir",
  "rm",
  "rmdir",
  "unlink",
  "truncate",
  "chmod",
  "chown",
  "chgrp",
]);
// Programs that write to their last argument.
const WRITE_LAST_ARGUMENT = new Set(["cp", "mv", "install", "ln", "rsync"]);
const SED = new Set(["sed"]);
const DD = new Set(["dd"]);
// Device files that any command may write to.
const DEVICES = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/;

const operands = (args: readonly string[]) =>
  args.filter((arg) => !arg.startsWith("-"));

function inPlaceEdits(command: SimpleCommand): string[] {
  return invocations(command, SED).flatMap((args) =>
    args.some((arg) => /^(-i|--in-place)/.test(arg)) ? operands(args) : [],
  );
}

function shellTargets(command: SimpleCommand): string[] {
  const every = invocations(command, WRITE_EVERY_ARGUMENT).flatMap(operands);
  const last = invocations(command, WRITE_LAST_ARGUMENT).flatMap((args) =>
    operands(args).slice(-1),
  );
  const ddOutputs = invocations(command, DD).flatMap((args) =>
    args.flatMap((arg) => (arg.startsWith("of=") ? [arg.slice(3)] : [])),
  );
  return [
    ...command.outputs,
    ...every,
    ...last,
    ...ddOutputs,
    ...inPlaceEdits(command),
  ];
}

function writeTargets(call: ToolCall): string[] {
  if (isWriteTool(call.tool)) return toolPaths(call);
  return call.commands.flatMap(shellTargets);
}

function problem(target: string, context: HookContext): string | undefined {
  if (DEVICES.test(target)) return undefined;
  const resolved = resolvePath(context.workspace, target);
  if (!resolved.inside) return `${target} is outside the workspace`;
  if (matchesGlob(patternPath(resolved), context.rules.deny_paths)) {
    return `${target} is a protected path`;
  }
  return undefined;
}

// Agents write only inside the workspace and never to the protected paths of
// hooks.deny_paths, such as .github/** (SEC-9.1). Shell commands are checked
// by their redirections and by the arguments of common file commands.
export const workspaceWrites: ToolPolicy = {
  name: "workspace-writes",
  category: "role",
  check(call, context) {
    const problems = writeTargets(call).flatMap((target) => {
      const found = problem(target, context);
      return found === undefined ? [] : [found];
    });
    if (problems.length === 0) return undefined;
    return `Agents may not write here: ${problems.join("; ")}.`;
  },
};
