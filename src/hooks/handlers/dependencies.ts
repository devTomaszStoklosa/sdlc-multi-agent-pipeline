import type { ToolCallLog, ToolCallRecord } from "../../audit/tool-log.ts";
import type { CommandRunner } from "../commands.ts";
import type { HookContext } from "../context.ts";
import { redactText } from "../redact.ts";

export interface HookDependencies {
  log: ToolCallLog;
  runner: CommandRunner;
  now: () => Date;
}

interface ToolEvent {
  session_id: string;
  tool_name: string;
  tool_input: Readonly<Record<string, unknown>>;
}

type Outcome = Pick<
  ToolCallRecord,
  "decision" | "blocks" | "duration_ms" | "redactions"
>;

const SUMMARY_FIELDS = ["command", "file_path", "notebook_path", "url", "path"];
const MAX_SUMMARY = 300;

// The input field that says the most about a call, redacted and shortened.
function summarize(input: Readonly<Record<string, unknown>>): string {
  const field = SUMMARY_FIELDS.map((name) => input[name]).find(
    (value) => typeof value === "string",
  );
  const text = typeof field === "string" ? field : JSON.stringify(input);
  const { value } = redactText(text);
  return value.length > MAX_SUMMARY ? `${value.slice(0, MAX_SUMMARY)}…` : value;
}

export function toolCallRecord(
  event: ToolEvent,
  context: HookContext,
  time: Date,
  outcome: Outcome,
): ToolCallRecord {
  return {
    time: time.toISOString(),
    session: event.session_id,
    role: context.role,
    tool: event.tool_name,
    input: summarize(event.tool_input),
    ...outcome,
  };
}

// Runs project commands one after another and describes each failure.
export async function failedChecks(
  runner: CommandRunner,
  checks: readonly (readonly [name: string, command: string])[],
  args: readonly string[],
): Promise<string[]> {
  const failures: string[] = [];
  for (const [name, command] of checks) {
    const result = await runner.run(command, args);
    if (!result.ok) {
      failures.push(`The ${name} (${command}) failed:\n${result.output}`);
    }
  }
  return failures;
}
