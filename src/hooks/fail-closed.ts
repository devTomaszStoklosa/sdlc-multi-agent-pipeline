import { BLOCK_EXIT_CODE, type HookResponse } from "./events.ts";
import { redactText, withhold } from "./redact.ts";

export type HookEventName =
  "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "Stop";

const WITHHELD =
  "[Output withheld: the pipeline hook failed, so it could not remove secrets.]";

// Replaces the tool output, because the hook could not check it for secrets.
// Without a readable output there is nothing to replace, and exit code 2
// at least tells the model that the hook failed.
function withheldOutput(rawInput: string, message: string): HookResponse {
  try {
    const event = JSON.parse(rawInput) as { tool_response?: unknown };
    const updatedToolOutput = withhold(event.tool_response, WITHHELD);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput },
      }),
    };
  } catch {
    return { exitCode: BLOCK_EXIT_CODE, stderr: message };
  }
}

const RESPONSES: Readonly<
  Record<HookEventName, (rawInput: string, message: string) => HookResponse>
> = {
  PreToolUse: (_rawInput, message) => ({
    exitCode: BLOCK_EXIT_CODE,
    stderr: message,
  }),
  PostToolUse: withheldOutput,
  // The call has already failed, so a failed log entry blocks nothing.
  PostToolUseFailure: (_rawInput, message) => ({
    exitCode: 1,
    stderr: message,
  }),
  Stop: (_rawInput, message) => ({
    exitCode: 0,
    stdout: JSON.stringify({ decision: "block", reason: message }),
  }),
};

// The answer of a hook that failed or ran out of time: block the call,
// withhold the output or refuse to stop (SEC-9.0a).
export function failClosed(
  event: HookEventName,
  rawInput: string,
  error: unknown,
): HookResponse {
  const cause = error instanceof Error ? error.message : String(error);
  const message = redactText(
    `The pipeline hook failed, so it blocked the action: ${cause}`,
  ).value;
  return RESPONSES[event](rawInput, message);
}

// Runs a hook handler and fails closed when it throws or misses its deadline,
// which is shorter than the hook timeout in the Claude Code settings.
export async function runFailClosed(
  event: HookEventName,
  rawInput: string,
  handler: () => Promise<HookResponse>,
  deadlineMs: number,
): Promise<HookResponse> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no answer within ${String(deadlineMs)} ms`));
    }, deadlineMs);
  });
  try {
    return await Promise.race([handler(), deadline]);
  } catch (error) {
    return failClosed(event, rawInput, error);
  } finally {
    clearTimeout(timer);
  }
}
