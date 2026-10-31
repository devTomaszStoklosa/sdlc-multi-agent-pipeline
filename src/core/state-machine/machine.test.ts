import { describe, expect, it } from "vitest";
import type { RunAction, RunEvent, RunProgress } from "./events.ts";
import { transition } from "./machine.ts";
import { ACTIVE_STATES, type RunStateName } from "./states.ts";
import { TRANSITIONS } from "./transitions.ts";

const LIMITS = { maxReviewRounds: 3 };

function progress(
  state: RunStateName,
  rest: Partial<RunProgress> = {},
): RunProgress {
  return { state, reviewRound: 0, findings: [], planVersion: 0, ...rest };
}

interface Case {
  rule: string;
  from: RunProgress;
  event: RunEvent;
  to: RunStateName;
  actions?: RunAction[];
  expect?: Partial<RunProgress>;
}

const planner: RunAction = { type: "start-role", role: "planner" };
const developer: RunAction = { type: "start-role", role: "developer" };
const reviewer: RunAction = { type: "start-role", role: "reviewer" };

const CASES: Case[] = [
  {
    rule: "queued-to-planning",
    from: progress("queued"),
    event: { type: "capacity-available" },
    to: "planning",
    actions: [planner],
  },
  {
    rule: "plan-to-developing",
    from: progress("planning"),
    event: { type: "plan-published", version: 1, highImpact: false },
    to: "developing",
    actions: [developer],
    expect: { planVersion: 1 },
  },
  {
    rule: "plan-to-approval",
    from: progress("planning"),
    event: { type: "plan-published", version: 2, highImpact: true },
    to: "awaiting-plan-approval",
    actions: [],
    expect: { planVersion: 2 },
  },
  {
    rule: "approval-to-developing",
    from: progress("awaiting-plan-approval", { planVersion: 2 }),
    event: {
      type: "plan-approved",
      version: 2,
      by: "author",
      at: "2026-10-29T10:00:00Z",
    },
    to: "developing",
    actions: [developer],
    expect: { approvedPlanVersion: 2 },
  },
  {
    rule: "approval-to-planning",
    from: progress("awaiting-plan-approval"),
    event: { type: "plan-changes-requested" },
    to: "planning",
    actions: [planner],
  },
  {
    rule: "developing-to-gating",
    from: progress("developing"),
    event: { type: "pushed", sha: "abc" },
    to: "gating",
    actions: [],
    expect: { pushedSha: "abc", planVersion: 0 },
  },
  {
    rule: "developing-to-gating",
    from: progress("developing", { planVersion: 1 }),
    event: { type: "pushed", sha: "abc", planVersion: 2 },
    to: "gating",
    actions: [],
    expect: { pushedSha: "abc", planVersion: 2 },
  },
  {
    rule: "plan-update-to-approval",
    from: progress("developing", { planVersion: 1, approvedPlanVersion: 1 }),
    event: { type: "plan-updated", version: 2, highImpact: true },
    to: "awaiting-plan-approval",
    actions: [],
    expect: { planVersion: 2, approvedPlanVersion: undefined },
  },
  {
    rule: "gates-failed",
    from: progress("gating", { pushedSha: "abc", reviewRound: 1 }),
    event: { type: "gates-completed", sha: "abc", passed: false },
    to: "developing",
    actions: [developer],
    expect: { reviewRound: 1 },
  },
  {
    rule: "gates-passed",
    from: progress("gating", { pushedSha: "abc", reviewRound: 1 }),
    event: { type: "gates-completed", sha: "abc", passed: true },
    to: "reviewing",
    actions: [reviewer],
    expect: { reviewRound: 2 },
  },
  {
    rule: "review-approved",
    from: progress("reviewing", { reviewRound: 1 }),
    event: { type: "verdict", verdict: "approve", blockingFindings: [] },
    to: "awaiting-human-review",
    actions: [],
  },
  {
    rule: "review-repeated-finding",
    from: progress("reviewing", { reviewRound: 2, findings: ["f1"] }),
    event: {
      type: "verdict",
      verdict: "changes_requested",
      blockingFindings: ["f1", "f2"],
    },
    to: "needs-human",
    actions: [
      {
        type: "escalate",
        reason: { kind: "repeated-finding", findings: ["f1"] },
      },
    ],
    expect: { resumeState: "reviewing", findings: ["f1", "f2"] },
  },
  {
    rule: "review-rounds-exhausted",
    from: progress("reviewing", { reviewRound: 3, findings: ["f1"] }),
    event: {
      type: "verdict",
      verdict: "changes_requested",
      blockingFindings: ["f3"],
    },
    to: "needs-human",
    actions: [
      { type: "escalate", reason: { kind: "review-rounds", rounds: 3 } },
    ],
  },
  {
    rule: "review-changes-requested",
    from: progress("reviewing", { reviewRound: 2, findings: ["f1"] }),
    event: {
      type: "verdict",
      verdict: "changes_requested",
      blockingFindings: ["f2"],
    },
    to: "developing",
    actions: [developer],
    expect: { findings: ["f1", "f2"] },
  },
  {
    rule: "stage-failed",
    from: progress("planning"),
    event: {
      type: "stage-failed",
      failure: "usage-limit",
      resetsAt: "2026-10-29T15:00:00Z",
    },
    to: "needs-human",
    actions: [
      {
        type: "escalate",
        reason: {
          kind: "stage-failed",
          failure: "usage-limit",
          resetsAt: "2026-10-29T15:00:00Z",
        },
      },
    ],
    expect: { resumeState: "planning" },
  },
  {
    rule: "limit-reached",
    from: progress("gating"),
    event: { type: "limit-reached", limit: "time" },
    to: "needs-human",
    actions: [{ type: "escalate", reason: { kind: "limit", limit: "time" } }],
    expect: { resumeState: "gating" },
  },
  {
    rule: "needs-human-resumed",
    from: progress("needs-human", {
      resumeState: "reviewing",
      reviewRound: 3,
    }),
    event: { type: "needs-human-removed" },
    to: "reviewing",
    actions: [reviewer],
    expect: { reviewRound: 1, resumeState: undefined },
  },
  {
    rule: "stopped",
    from: progress("developing"),
    event: { type: "stop-requested" },
    to: "stopped",
    actions: [],
  },
  {
    rule: "pr-closed",
    from: progress("awaiting-human-review"),
    event: { type: "pr-closed", merged: true },
    to: "done",
    actions: [],
  },
];

describe("transition", () => {
  it.each(CASES)(
    "$rule",
    ({ rule, from, event, to, actions, expect: fields }) => {
      const result = transition(from, event, LIMITS);
      expect(result).toMatchObject({ applied: true, rule });
      if (!result.applied) return;
      expect(result.progress.state).toBe(to);
      if (actions !== undefined) expect(result.actions).toEqual(actions);
      for (const [key, value] of Object.entries(fields ?? {})) {
        expect(result.progress[key as keyof RunProgress]).toEqual(value);
      }
    },
  );

  it("has a test case for every transition rule", () => {
    const tested = new Set(CASES.map((testCase) => testCase.rule));
    expect(
      TRANSITIONS.map((rule) => rule.name).filter((name) => !tested.has(name)),
    ).toEqual([]);
  });

  it.each(ACTIVE_STATES)("stops and closes a run in %s", (state) => {
    for (const [event, to] of [
      [{ type: "stop-requested" }, "stopped"],
      [{ type: "pr-closed", merged: false }, "done"],
    ] as const) {
      const result = transition(progress(state), event, LIMITS);
      expect(result).toMatchObject({ applied: true, progress: { state: to } });
    }
  });

  it.each(["stopped", "done"] as const)(
    "changes nothing in the terminal state %s",
    (state) => {
      for (const event of [
        { type: "stop-requested" },
        { type: "pr-closed", merged: true },
        { type: "needs-human-removed" },
        { type: "capacity-available" },
      ] as const) {
        expect(transition(progress(state), event, LIMITS).applied).toBe(false);
      }
    },
  );

  it("ignores plan approval outside awaiting-plan-approval (FR-4.5)", () => {
    const event: RunEvent = {
      type: "plan-approved",
      version: 1,
      by: "author",
      at: "2026-10-29T10:00:00Z",
    };
    expect(transition(progress("developing"), event, LIMITS).applied).toBe(
      false,
    );
  });

  it("ignores gate results of an earlier push (FR-4.12)", () => {
    const event: RunEvent = {
      type: "gates-completed",
      sha: "old",
      passed: true,
    };
    const from = progress("gating", { pushedSha: "new" });
    expect(transition(from, event, LIMITS).applied).toBe(false);
  });

  it("does not escalate from a waiting state", () => {
    const event: RunEvent = { type: "limit-reached", limit: "cost" };
    expect(
      transition(progress("awaiting-plan-approval"), event, LIMITS).applied,
    ).toBe(false);
  });

  it("does not resume a run without a state to resume", () => {
    const event: RunEvent = { type: "needs-human-removed" };
    expect(transition(progress("needs-human"), event, LIMITS).applied).toBe(
      false,
    );
  });

  it("ignores a plan update that is not high-impact", () => {
    const event: RunEvent = {
      type: "plan-updated",
      version: 2,
      highImpact: false,
    };
    expect(transition(progress("developing"), event, LIMITS).applied).toBe(
      false,
    );
  });
});
