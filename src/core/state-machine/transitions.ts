import type {
  EscalationReason,
  RunAction,
  RunEvent,
  RunEventType,
  RunProgress,
  TransitionLimits,
} from "./events.ts";
import {
  ACTIVE_STATES,
  WORKING_STATES,
  isActive,
  roleOf,
  type RunStateName,
} from "./states.ts";

export interface Outcome {
  progress: RunProgress;
  actions: RunAction[];
}

type EventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;

interface RuleDefinition<T extends RunEventType> {
  name: string;
  from: readonly RunStateName[];
  event: T;
  when?: (
    progress: RunProgress,
    event: EventOf<T>,
    limits: TransitionLimits,
  ) => boolean;
  apply: (
    progress: RunProgress,
    event: EventOf<T>,
    limits: TransitionLimits,
  ) => Outcome;
}

export interface TransitionRule {
  name: string;
  from: readonly RunStateName[];
  event: RunEventType;
  matches(
    progress: RunProgress,
    event: RunEvent,
    limits: TransitionLimits,
  ): boolean;
  apply(
    progress: RunProgress,
    event: RunEvent,
    limits: TransitionLimits,
  ): Outcome;
}

// Each rule narrows the event to its own type, so the table stays type-safe.
function rule<T extends RunEventType>(
  definition: RuleDefinition<T>,
): TransitionRule {
  const { name, from, event, when, apply } = definition;
  return {
    name,
    from,
    event,
    matches: (progress, given, limits) =>
      given.type === event &&
      from.includes(progress.state) &&
      (when?.(progress, given as EventOf<T>, limits) ?? true),
    apply: (progress, given, limits) =>
      apply(progress, given as EventOf<T>, limits),
  };
}

// Moves to a state and starts its role, if it has one.
function enter(progress: RunProgress, state: RunStateName): Outcome {
  const role = roleOf(state);
  return {
    progress: { ...progress, state },
    actions: role === undefined ? [] : [{ type: "start-role", role }],
  };
}

// Escalation keeps the state to resume from when a human removes the label.
function escalate(progress: RunProgress, reason: EscalationReason): Outcome {
  return {
    progress: {
      ...progress,
      state: "needs-human",
      resumeState: isActive(progress.state) ? progress.state : undefined,
    },
    actions: [{ type: "escalate", reason }],
  };
}

function repeatedFindings(
  progress: RunProgress,
  event: EventOf<"verdict">,
): string[] {
  return event.blockingFindings.filter((id) => progress.findings.includes(id));
}

function withFindings(
  progress: RunProgress,
  event: EventOf<"verdict">,
): RunProgress {
  const findings = [
    ...new Set([...progress.findings, ...event.blockingFindings]),
  ];
  return { ...progress, findings };
}

const changesRequested = (
  _progress: RunProgress,
  event: EventOf<"verdict">,
): boolean => event.verdict === "changes_requested";

// The MVP transitions of spec 4.2. A new transition is a new rule. The first
// matching rule wins, so the escalations of a review come before the return
// to development.
export const TRANSITIONS: readonly TransitionRule[] = [
  rule({
    name: "queued-to-planning",
    from: ["queued"],
    event: "capacity-available",
    apply: (progress) => enter(progress, "planning"),
  }),
  rule({
    name: "plan-to-developing",
    from: ["planning"],
    event: "plan-published",
    when: (_progress, event) => !event.highImpact,
    apply: (progress, event) =>
      enter({ ...progress, planVersion: event.version }, "developing"),
  }),
  rule({
    name: "plan-to-approval",
    from: ["planning"],
    event: "plan-published",
    when: (_progress, event) => event.highImpact,
    apply: (progress, event) =>
      enter(
        { ...progress, planVersion: event.version },
        "awaiting-plan-approval",
      ),
  }),
  rule({
    name: "approval-to-developing",
    from: ["awaiting-plan-approval"],
    event: "plan-approved",
    apply: (progress, event) =>
      enter({ ...progress, approvedPlanVersion: event.version }, "developing"),
  }),
  rule({
    name: "approval-to-planning",
    from: ["awaiting-plan-approval"],
    event: "plan-changes-requested",
    apply: (progress) => enter(progress, "planning"),
  }),
  rule({
    name: "developing-to-gating",
    from: ["developing"],
    event: "pushed",
    apply: (progress, event) =>
      enter({ ...progress, pushedSha: event.sha }, "gating"),
  }),
  rule({
    name: "plan-update-to-approval",
    from: ["developing"],
    event: "plan-updated",
    when: (_progress, event) => event.highImpact,
    apply: (progress, event) =>
      enter(
        {
          ...progress,
          planVersion: event.version,
          approvedPlanVersion: undefined,
        },
        "awaiting-plan-approval",
      ),
  }),
  // Results of an earlier push do not count (FR-4.12).
  rule({
    name: "gates-failed",
    from: ["gating"],
    event: "gates-completed",
    when: (progress, event) =>
      event.sha === progress.pushedSha && !event.passed,
    apply: (progress) => enter(progress, "developing"),
  }),
  rule({
    name: "gates-passed",
    from: ["gating"],
    event: "gates-completed",
    when: (progress, event) => event.sha === progress.pushedSha && event.passed,
    apply: (progress) =>
      enter(
        { ...progress, reviewRound: progress.reviewRound + 1 },
        "reviewing",
      ),
  }),
  rule({
    name: "review-approved",
    from: ["reviewing"],
    event: "verdict",
    when: (_progress, event) => event.verdict === "approve",
    apply: (progress) => enter(progress, "awaiting-human-review"),
  }),
  rule({
    name: "review-repeated-finding",
    from: ["reviewing"],
    event: "verdict",
    when: (progress, event) =>
      changesRequested(progress, event) &&
      repeatedFindings(progress, event).length > 0,
    apply: (progress, event) =>
      escalate(withFindings(progress, event), {
        kind: "repeated-finding",
        findings: repeatedFindings(progress, event),
      }),
  }),
  rule({
    name: "review-rounds-exhausted",
    from: ["reviewing"],
    event: "verdict",
    when: (progress, event, limits) =>
      changesRequested(progress, event) &&
      progress.reviewRound >= limits.maxReviewRounds,
    apply: (progress, event) =>
      escalate(withFindings(progress, event), {
        kind: "review-rounds",
        rounds: progress.reviewRound,
      }),
  }),
  rule({
    name: "review-changes-requested",
    from: ["reviewing"],
    event: "verdict",
    when: changesRequested,
    apply: (progress, event) =>
      enter(withFindings(progress, event), "developing"),
  }),
  rule({
    name: "stage-failed",
    from: WORKING_STATES,
    event: "stage-failed",
    apply: (progress, event) =>
      escalate(progress, {
        kind: "stage-failed",
        failure: event.failure,
        resetsAt: event.resetsAt,
      }),
  }),
  rule({
    name: "limit-reached",
    from: WORKING_STATES,
    event: "limit-reached",
    apply: (progress, event) =>
      escalate(progress, { kind: "limit", limit: event.limit }),
  }),
  // A resumed run gets a new review round budget (FR-4.32).
  rule({
    name: "needs-human-resumed",
    from: ["needs-human"],
    event: "needs-human-removed",
    when: (progress) => progress.resumeState !== undefined,
    apply: (progress) => {
      const state = progress.resumeState ?? "needs-human";
      const reviewRound = state === "reviewing" ? 1 : 0;
      return enter({ ...progress, resumeState: undefined, reviewRound }, state);
    },
  }),
  rule({
    name: "stopped",
    from: ACTIVE_STATES,
    event: "stop-requested",
    apply: (progress) => enter(progress, "stopped"),
  }),
  rule({
    name: "pr-closed",
    from: ACTIVE_STATES,
    event: "pr-closed",
    apply: (progress) => enter(progress, "done"),
  }),
];
