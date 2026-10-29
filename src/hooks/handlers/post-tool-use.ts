import type { HookContext } from "../context.ts";
import type {
  HookResponse,
  PostToolUseEvent,
  PostToolUseFailureEvent,
} from "../events.ts";
import { isWriteTool, toolPaths, toToolCall } from "../policy.ts";
import { redactText, redactValue } from "../redact.ts";
import {
  failedChecks,
  toolCallRecord,
  type HookDependencies,
} from "./dependencies.ts";

// Runs the formatter and then the linter on a file the agent has just written,
// so the agent sees the problems at once (QG-9.9).
async function checkWrittenFile(
  event: PostToolUseEvent,
  context: HookContext,
  dependencies: HookDependencies,
): Promise<string | undefined> {
  if (!isWriteTool(event.tool_name)) return undefined;
  const files = toolPaths(toToolCall(event.tool_name, event.tool_input));
  if (files.length === 0) return undefined;
  const { format, lint } = context.commands;
  const checks = [
    ["formatter", format],
    ["linter", lint],
  ] as const;
  const failures = await failedChecks(dependencies.runner, checks, files);
  return failures.length === 0 ? undefined : failures.join("\n\n");
}

// Removes secrets from the tool output before the model sees it (SEC-9.10),
// sends formatter and linter errors back to the agent (QG-9.9) and logs the
// call (NFR-9.11).
export async function handlePostToolUse(
  event: PostToolUseEvent,
  context: HookContext,
  dependencies: HookDependencies,
): Promise<HookResponse> {
  const output = redactValue(event.tool_response);
  const problems = await checkWrittenFile(event, context, dependencies);
  await dependencies.log.append(
    toolCallRecord(event, context, dependencies.now(), {
      decision: "allowed",
      duration_ms: event.duration_ms,
      redactions: output.count,
    }),
  );
  const answer = {
    ...(problems === undefined
      ? {}
      : { decision: "block", reason: redactText(problems).value }),
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      ...(output.count > 0 ? { updatedToolOutput: output.value } : {}),
    },
  };
  return { exitCode: 0, stdout: JSON.stringify(answer) };
}

// Logs a call that failed while it ran (NFR-9.11).
export async function handlePostToolUseFailure(
  event: PostToolUseFailureEvent,
  context: HookContext,
  dependencies: HookDependencies,
): Promise<HookResponse> {
  await dependencies.log.append(
    toolCallRecord(event, context, dependencies.now(), {
      decision: "failed",
      duration_ms: event.duration_ms,
    }),
  );
  return { exitCode: 0 };
}
