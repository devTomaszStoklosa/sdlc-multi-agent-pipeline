import type { RunEventLog } from "../audit/run-events.ts";
import {
  roleResultSchema,
  SessionAbortedError,
  type RoleInput,
  type RoleResult,
  type RoleRunner,
  type RoleUsage,
} from "../agents/role-runner.ts";
import { redactText } from "../hooks/redact.ts";
import { RunInactiveError } from "./guard.ts";

const RETRYABLE = new Set(["infra", "usage-limit"]);
export const NO_USAGE: RoleUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  turns: 0,
};

function addUsage(total: RoleUsage, more: RoleUsage): RoleUsage {
  return {
    input_tokens: total.input_tokens + more.input_tokens,
    output_tokens: total.output_tokens + more.output_tokens,
    cost_usd: total.cost_usd + more.cost_usd,
    turns: total.turns + more.turns,
  };
}

export interface StageSessionContext {
  runner: RoleRunner;
  log: RunEventLog;
  now: () => Date;
  workflowRunId: number;
}

export type Session =
  | { timedOut: false; result: RoleResult; attempts: number; usage: RoleUsage }
  | { timedOut: true; attempts: number; usage: RoleUsage };

// A session that the stop or the time limit ended, with the usage the runner
// knew so far (#61).
interface Aborted {
  aborted: "stopped" | "timed-out";
  usage: RoleUsage;
}

async function attempt(
  runner: RoleRunner,
  input: RoleInput,
  signal: AbortSignal,
): Promise<RoleResult | Aborted> {
  try {
    const parsed = roleResultSchema.safeParse(await runner.run(input, signal));
    if (parsed.success) return parsed.data;
    return {
      status: "failed",
      failure: "infra",
      message: "Invalid session result",
      usage: NO_USAGE,
    };
  } catch (error) {
    // A stop ends the job without side effects; the time limit escalates.
    if (signal.aborted) {
      return {
        aborted:
          signal.reason instanceof RunInactiveError ? "stopped" : "timed-out",
        usage: error instanceof SessionAbortedError ? error.usage : NO_USAGE,
      };
    }
    // The message reaches the job's log and the run events, which are public.
    const text = error instanceof Error ? error.message : String(error);
    const message = redactText(text).value;
    return { status: "failed", failure: "infra", message, usage: NO_USAGE };
  }
}

function logAttempt(
  context: StageSessionContext,
  input: RoleInput,
  result: RoleResult | Aborted,
) {
  const aborted = "aborted" in result;
  return context.log.append({
    time: context.now().toISOString(),
    type: "stage-attempt",
    issue: input.issue.number,
    run: input.runId,
    agent: input.role,
    workflow_run: context.workflowRunId,
    result: aborted
      ? result.aborted
      : result.status === "ok"
        ? "ok"
        : result.failure,
    round: input.reviewRound,
    tokens: {
      input: result.usage.input_tokens,
      output: result.usage.output_tokens,
    },
    // An aborted session's cost is unknown, and its output tokens are a
    // lower bound (#61).
    ...(aborted ? {} : { cost_usd: result.usage.cost_usd }),
    // The cause of a failed attempt, so the role job's own events explain
    // it (NFR-11.3).
    details: aborted
      ? { attempt: input.attempt, partial: true }
      : result.status === "ok"
        ? { attempt: input.attempt }
        : { attempt: input.attempt, message: result.message },
  });
}

export interface SessionLimits {
  retries: number;
  minutes: number;
  stop: AbortSignal;
}

// One stage: the session and its retries after infrastructure errors, within
// the run's remaining time (FR-4.30, NFR-11.5), until a stop. The timeout
// takes whole milliseconds, rounded down so the session stays within the limit.
// The usage of a timed-out session counts towards the run's (#61).
export async function session(
  context: StageSessionContext,
  given: Omit<RoleInput, "attempt">,
  limits: SessionLimits,
): Promise<Session> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(Math.max(1, Math.floor(limits.minutes * 60_000))),
    limits.stop,
  ]);
  let usage = NO_USAGE;
  for (let attempts = 1; ; attempts++) {
    const input = { ...given, attempt: attempts };
    const result = await attempt(context.runner, input, signal);
    usage = addUsage(usage, result.usage);
    await logAttempt(context, input, result);
    if ("aborted" in result) {
      if (result.aborted === "stopped") throw signal.reason;
      return { timedOut: true, attempts, usage };
    }
    const retry = result.status === "failed" && RETRYABLE.has(result.failure);
    if (!retry || attempts > limits.retries)
      return { timedOut: false, result, attempts, usage };
  }
}
