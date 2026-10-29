import { z } from "zod";
import { ROLES } from "../../hooks/roles.ts";
import type { RunProgress } from "../state-machine/events.ts";
import {
  ACTIVE_STATES,
  RUN_STATES,
  TERMINAL_STATES,
  type RunStateName,
} from "../state-machine/states.ts";

export const RUN_RECORD_SCHEMA = 1;

const sha = z.string().regex(/^[0-9a-f]{7,64}$/);
const time = z.iso.datetime({ offset: true });
const positive = z.number().int().min(1);
const count = z.number().int().min(0);

const progressSchema = z.object({
  state: z.enum(RUN_STATES),
  resumeState: z.enum(ACTIVE_STATES).optional(),
  reviewRound: count,
  findings: z.array(z.string()),
  planVersion: count,
  approvedPlanVersion: positive.optional(),
  pushedSha: sha.optional(),
});

// Usage reported by a role session, per stage and review round (NFR-11.4).
const usageSchema = z.object({
  role: z.enum(ROLES),
  round: count,
  attempts: positive,
  inputTokens: count,
  outputTokens: count,
  costUsd: z.number().min(0),
  turns: count,
});

const runSchema = z.object({
  id: z.string().min(1),
  number: positive,
  startedAt: time,
  startedBy: z.string().min(1),
  // The validated .sdlc-agents.yml from the main branch at the start of the
  // run and its commit (FR-10.5). Stopping uses only the label names (FR-10.4).
  config: z.object({ sha, text: z.string() }),
  labels: z.object({
    ready: z.string().min(1),
    needs_human: z.string().min(1),
    plan_approved: z.string().min(1),
  }),
  progress: progressSchema,
  history: z.array(z.object({ state: z.enum(RUN_STATES), at: time })),
  // The workflow run that works on the run now; stopping cancels it.
  workflowRun: z.object({ id: positive, role: z.enum(ROLES).optional() }),
  admittedAt: time.optional(),
  branch: z.string().min(1).optional(),
  pr: positive.optional(),
  pushes: count,
  approval: z
    .object({ version: positive, by: z.string(), at: time })
    .optional(),
  usage: z.array(usageSchema),
  stop: z
    .object({
      by: z.string(),
      where: z.enum(["issue", "pr"]),
      labeledAt: time,
      summaryUrl: z.string().optional(),
    })
    .optional(),
  end: z
    .object({
      state: z.enum(TERMINAL_STATES),
      at: time,
      merged: z.boolean().optional(),
    })
    .optional(),
});

const previousRunSchema = z.object({
  id: z.string(),
  state: z.enum(RUN_STATES),
  branch: z.string().optional(),
  pr: positive.optional(),
  endedAt: time.optional(),
});

export const runRecordSchema = z.object({
  schema: z.literal(RUN_RECORD_SCHEMA),
  revision: count,
  issue: positive,
  run: runSchema,
  previousRuns: z.array(previousRunSchema),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
export type Run = RunRecord["run"];
export type RunUsage = Run["usage"][number];
export type RunLabels = Run["labels"];

export interface NewRun {
  issue: number;
  startedBy: string;
  config: Run["config"];
  labels: RunLabels;
  workflowRunId: number;
  now: Date;
}

// A new run in `queued`, keeping the earlier runs of the issue. A new run has
// new budgets (FR-4.28b), so nothing but the history carries over.
export function newRunRecord(
  given: NewRun,
  previous: RunRecord | undefined,
): RunRecord {
  const number = (previous?.run.number ?? 0) + 1;
  const at = given.now.toISOString();
  const previousRuns = previous
    ? [
        ...previous.previousRuns,
        {
          id: previous.run.id,
          state: previous.run.progress.state,
          branch: previous.run.branch,
          pr: previous.run.pr,
          endedAt: previous.run.end?.at,
        },
      ]
    : [];
  return {
    schema: RUN_RECORD_SCHEMA,
    revision: previous?.revision ?? 0,
    issue: given.issue,
    run: {
      id: `${String(given.issue)}-${String(number)}`,
      number,
      startedAt: at,
      startedBy: given.startedBy,
      config: given.config,
      labels: given.labels,
      progress: {
        state: "queued",
        reviewRound: 0,
        findings: [],
        planVersion: 0,
      },
      history: [{ state: "queued", at }],
      workflowRun: { id: given.workflowRunId },
      pushes: 0,
      usage: [],
    },
    previousRuns,
  };
}

// The run with new progress. A change of state is added to the history, which
// the time limit reads (NFR-11.5).
export function withProgress(run: Run, progress: RunProgress, now: Date): Run {
  const changed = progress.state !== run.progress.state;
  const history = changed
    ? [...run.history, { state: progress.state, at: now.toISOString() }]
    : run.history;
  return { ...run, progress, history };
}

export function stateOf(record: RunRecord): RunStateName {
  return record.run.progress.state;
}
