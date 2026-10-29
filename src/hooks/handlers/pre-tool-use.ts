import type { HookContext } from "../context.ts";
import {
  BLOCK_EXIT_CODE,
  type HookResponse,
  type PreToolUseEvent,
} from "../events.ts";
import { evaluate, toToolCall, type ToolPolicy } from "../policy.ts";
import { toolCallRecord, type HookDependencies } from "./dependencies.ts";

// Blocks a call that any policy rejects and logs the block (SEC-9.1 to
// SEC-9.8, NFR-9.11). An allowed call is logged after it runs, with its
// duration. The hook never answers "allow", so Claude Code's own permission
// rules still apply.
export async function handlePreToolUse(
  event: PreToolUseEvent,
  context: HookContext,
  dependencies: HookDependencies,
  policies: readonly ToolPolicy[],
): Promise<HookResponse> {
  const call = toToolCall(event.tool_name, event.tool_input);
  const blocks = evaluate(call, context, policies);
  if (blocks.length === 0) return { exitCode: 0 };
  await dependencies.log.append(
    toolCallRecord(event, context, dependencies.now(), {
      decision: "denied",
      blocks,
    }),
  );
  const reasons = blocks.map((block) => `- ${block.reason}`).join("\n");
  return {
    exitCode: BLOCK_EXIT_CODE,
    stderr: `The pipeline hooks blocked this call:\n${reasons}`,
  };
}
