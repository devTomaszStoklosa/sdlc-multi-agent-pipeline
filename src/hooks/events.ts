import { z } from "zod";

// Hook input from Claude Code on standard input. Unknown fields are kept,
// because new Claude Code versions add them.
const toolCall = {
  session_id: z.string(),
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
};

export const preToolUseEvent = z.looseObject({
  hook_event_name: z.literal("PreToolUse"),
  ...toolCall,
});

export const postToolUseEvent = z.looseObject({
  hook_event_name: z.literal("PostToolUse"),
  ...toolCall,
  tool_response: z.unknown(),
  duration_ms: z.number().optional(),
});

export const postToolUseFailureEvent = z.looseObject({
  hook_event_name: z.literal("PostToolUseFailure"),
  ...toolCall,
  duration_ms: z.number().optional(),
});

export const stopEvent = z.looseObject({
  hook_event_name: z.literal("Stop"),
  session_id: z.string(),
});

export type PreToolUseEvent = z.infer<typeof preToolUseEvent>;
export type PostToolUseEvent = z.infer<typeof postToolUseEvent>;
export type PostToolUseFailureEvent = z.infer<typeof postToolUseFailureEvent>;

// What a hook process returns to Claude Code. Exit code 2 blocks the action.
export interface HookResponse {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export const BLOCK_EXIT_CODE = 2;
