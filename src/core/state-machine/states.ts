import type { Role } from "../../hooks/roles.ts";

// The MVP states of a run (spec 4.1, plan 1.2). `deploying-dev` and
// `handling-comments` come after the MVP.
export const WAITING_STATES = [
  "queued",
  "awaiting-plan-approval",
  "awaiting-human-review",
  "needs-human",
] as const;
export const WORKING_STATES = [
  "planning",
  "developing",
  "gating",
  "reviewing",
] as const;
export const TERMINAL_STATES = ["stopped", "done"] as const;
export const ACTIVE_STATES = [...WAITING_STATES, ...WORKING_STATES] as const;
export const RUN_STATES = [...ACTIVE_STATES, ...TERMINAL_STATES] as const;

export type WaitingState = (typeof WAITING_STATES)[number];
export type WorkingState = (typeof WORKING_STATES)[number];
export type TerminalState = (typeof TERMINAL_STATES)[number];
export type RunStateName = (typeof RUN_STATES)[number];
export type ActiveState = WaitingState | WorkingState;

// No agent works in a waiting state, and its time does not count towards the
// run's time limit (NFR-11.5).
export function isWorking(state: RunStateName): state is WorkingState {
  return (WORKING_STATES as readonly string[]).includes(state);
}

export function isTerminal(state: RunStateName): state is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

export function isActive(state: RunStateName): state is ActiveState {
  return !isTerminal(state);
}

// The role whose job does the work of a state. Gating waits for the gates
// workflow of the repository, so it has no role.
const STATE_ROLES: Partial<Record<RunStateName, Role>> = {
  planning: "planner",
  developing: "developer",
  reviewing: "reviewer",
};

export function roleOf(state: RunStateName): Role | undefined {
  return STATE_ROLES[state];
}
