import type { ActiveState, RunStateName } from "./states.ts";

export const LIMITS = ["time", "cost", "turns"] as const;
export type LimitName = (typeof LIMITS)[number];

export const STAGE_FAILURES = ["infra", "usage-limit"] as const;
export type StageFailure = (typeof STAGE_FAILURES)[number];

// What happened to a run, after the orchestrator code checked who caused it
// (spec 9.4). Events carry only the facts a transition needs.
export type RunEvent =
  | { type: "capacity-available" }
  | { type: "plan-published"; version: number; highImpact: boolean }
  | { type: "plan-approved"; version: number; by: string; at: string }
  | { type: "plan-changes-requested" }
  | { type: "pushed"; sha: string }
  | { type: "plan-updated"; version: number; highImpact: boolean }
  | { type: "gates-completed"; sha: string; passed: boolean }
  | {
      type: "verdict";
      verdict: "approve" | "changes_requested";
      blockingFindings: readonly string[];
    }
  // A stage that failed after its retry budget (FR-4.30).
  | { type: "stage-failed"; failure: StageFailure; resetsAt?: string }
  | { type: "limit-reached"; limit: LimitName }
  | { type: "needs-human-removed" }
  | { type: "stop-requested" }
  | { type: "pr-closed"; merged: boolean };

export type RunEventType = RunEvent["type"];

// The part of a run's state that transitions read and change.
export interface RunProgress {
  state: RunStateName;
  // The state before an escalation, to resume from (FR-4.32).
  resumeState?: ActiveState;
  reviewRound: number;
  // Blocking finding identifiers reported in earlier rounds (FR-4.18).
  findings: string[];
  planVersion: number;
  approvedPlanVersion?: number;
  pushedSha?: string;
}

export type EscalationReason =
  | { kind: "review-rounds"; rounds: number }
  | { kind: "repeated-finding"; findings: string[] }
  | { kind: "stage-failed"; failure: StageFailure; resetsAt?: string }
  | { kind: "limit"; limit: LimitName };

// Side effects a transition asks for. The orchestrator code performs them
// after the check of FR-4.28c.
export type RunAction =
  | { type: "start-role"; role: "planner" | "developer" | "reviewer" }
  | { type: "escalate"; reason: EscalationReason };

export interface TransitionLimits {
  maxReviewRounds: number;
}
