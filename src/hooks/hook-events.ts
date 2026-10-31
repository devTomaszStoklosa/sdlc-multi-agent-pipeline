import type { HookContext } from "./context.ts";
import {
  postToolUseEvent,
  postToolUseFailureEvent,
  preToolUseEvent,
  stopEvent,
  type HookResponse,
} from "./events.ts";
import type { HookEventName } from "./fail-closed.ts";
import type { HookDependencies } from "./handlers/dependencies.ts";
import {
  handlePostToolUse,
  handlePostToolUseFailure,
} from "./handlers/post-tool-use.ts";
import { handlePreToolUse } from "./handlers/pre-tool-use.ts";
import { handleStop } from "./handlers/stop.ts";
import { BASE_POLICIES } from "./policies/index.ts";

export interface HookEvent {
  name: HookEventName;
  // The Claude Code hook timeout. The handler answers a few seconds earlier.
  timeoutSeconds: number;
  // The limit for each project command the hook runs.
  commandTimeoutMs: number;
  handle(
    input: unknown,
    context: HookContext,
    dependencies: HookDependencies,
  ): Promise<HookResponse>;
}

// The margin between the handler's deadline and the hook timeout, so the
// fail-closed answer reaches Claude Code before it gives up on the hook.
export const DEADLINE_MARGIN_MS = 5000;

// Hook events by command-line name. A new event is a new entry.
export const HOOK_EVENTS: ReadonlyMap<string, HookEvent> = new Map([
  [
    "pre-tool-use",
    {
      name: "PreToolUse",
      timeoutSeconds: 15,
      commandTimeoutMs: 0,
      handle: (input, context, dependencies) =>
        handlePreToolUse(
          preToolUseEvent.parse(input),
          context,
          dependencies,
          BASE_POLICIES,
        ),
    },
  ],
  [
    "post-tool-use",
    {
      name: "PostToolUse",
      timeoutSeconds: 150,
      commandTimeoutMs: 60_000,
      handle: (input, context, dependencies) =>
        handlePostToolUse(postToolUseEvent.parse(input), context, dependencies),
    },
  ],
  [
    "post-tool-use-failure",
    {
      name: "PostToolUseFailure",
      timeoutSeconds: 15,
      commandTimeoutMs: 0,
      handle: (input, context, dependencies) =>
        handlePostToolUseFailure(
          postToolUseFailureEvent.parse(input),
          context,
          dependencies,
        ),
    },
  ],
  [
    "stop",
    {
      name: "Stop",
      timeoutSeconds: 900,
      commandTimeoutMs: 420_000,
      handle: (input, context, dependencies) =>
        handleStop(stopEvent.parse(input), context, dependencies),
    },
  ],
] as const);
