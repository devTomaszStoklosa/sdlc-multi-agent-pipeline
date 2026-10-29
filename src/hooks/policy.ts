import type { HookContext } from "./context.ts";
import { WRITE_TOOLS } from "./roles.ts";
import { parseShell, type SimpleCommand } from "./shell/parse.ts";

// Block categories of metric M-E01.
export type BlockCategory =
  "secrets" | "protected-branch" | "network" | "destructive" | "role";

export interface ToolCall {
  tool: string;
  input: Readonly<Record<string, unknown>>;
  // The command line of a Bash call, empty for other tools.
  line: string;
  commands: readonly SimpleCommand[];
}

// One rule checked before a tool call. A new rule is a new policy, so the code
// that runs the policies does not change (SEC-9.0b, plan 3.3).
export interface ToolPolicy {
  readonly name: string;
  readonly category: BlockCategory;
  // The reason to block the call, or undefined to let it through.
  check(call: ToolCall, context: HookContext): string | undefined;
}

export interface Denial {
  policy: string;
  category: BlockCategory;
  reason: string;
}

const PATH_FIELDS = ["file_path", "notebook_path", "path"];

// A Bash call without a command line cannot be checked, so it is an error.
export function toToolCall(
  tool: string,
  input: Readonly<Record<string, unknown>>,
): ToolCall {
  if (tool !== "Bash") return { tool, input, line: "", commands: [] };
  const line = input.command;
  if (typeof line !== "string") {
    throw new Error("Bash call without a command line");
  }
  return { tool, input, line, commands: parseShell(line) };
}

// The paths a file tool reads, searches or writes.
export function toolPaths(call: ToolCall): string[] {
  return PATH_FIELDS.flatMap((field) => {
    const value = call.input[field];
    return typeof value === "string" ? [value] : [];
  });
}

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOLS.includes(tool);
}

export function evaluate(
  call: ToolCall,
  context: HookContext,
  policies: readonly ToolPolicy[],
): Denial[] {
  return policies.flatMap((policy) => {
    const reason = policy.check(call, context);
    if (reason === undefined) return [];
    return [{ policy: policy.name, category: policy.category, reason }];
  });
}
