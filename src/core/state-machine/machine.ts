import type {
  RunAction,
  RunEvent,
  RunProgress,
  TransitionLimits,
} from "./events.ts";
import { TRANSITIONS } from "./transitions.ts";

export type TransitionResult =
  | {
      applied: true;
      rule: string;
      progress: RunProgress;
      actions: RunAction[];
    }
  | { applied: false; reason: string };

// The orchestrator's control flow as a pure function (FR-5.6): the current
// progress and an event in, the new progress and the side effects out. An
// event with no matching transition changes nothing, e.g. `plan:approved`
// added outside `awaiting-plan-approval` (FR-4.5) or any event of a stopped run
// (FR-4.28).
export function transition(
  progress: RunProgress,
  event: RunEvent,
  limits: TransitionLimits,
): TransitionResult {
  const found = TRANSITIONS.find((candidate) =>
    candidate.matches(progress, event, limits),
  );
  if (found === undefined) {
    return {
      applied: false,
      reason: `No transition from ${progress.state} on ${event.type}`,
    };
  }
  return {
    applied: true,
    rule: found.name,
    ...found.apply(progress, event, limits),
  };
}
