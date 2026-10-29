import { parseRepoConfig } from "../config/parse.ts";
import { resolvePolicy } from "../config/policy.ts";
import type { OrgBaseline } from "../config/schema.ts";
import type { Run } from "../core/run-store/run-record.ts";
import type { LimitName } from "../core/state-machine/events.ts";
import { workingMinutes } from "../core/state-machine/working-time.ts";

export interface RunLimits {
  maxReviewRounds: number;
  stageRetries: number;
  maxCostUsd: number;
  maxMinutes: number;
  maxTurnsPerStage: number;
}

// The limits of a run come from its configuration copy merged with the
// current organization baseline (FR-10.5): a change of .sdlc-agents.yml during
// the run does not apply, a tightened baseline applies at once.
export function runLimits(run: Run, baseline: OrgBaseline): RunLimits {
  const parsed = parseRepoConfig(run.config.text);
  if (!parsed.ok) {
    throw new Error(`The configuration copy of run ${run.id} is invalid.`);
  }
  const { limits, review } = resolvePolicy(parsed.value, baseline).effective;
  return {
    maxReviewRounds: review.max_rounds,
    stageRetries: limits.stage_retries,
    maxCostUsd: limits.max_cost_usd_per_run,
    maxMinutes: limits.max_minutes_per_run,
    maxTurnsPerStage: limits.max_turns_per_stage,
  };
}

export function costUsd(run: Run): number {
  return run.usage.reduce((sum, entry) => sum + entry.costUsd, 0);
}

// The limit a run has reached (NFR-11.5, FR-4.31). Time counts only in
// working states, and cost is the usage estimate that Claude Code reports.
export function reachedLimit(
  run: Run,
  limits: RunLimits,
  now: Date,
): LimitName | undefined {
  if (workingMinutes(run.history, now) >= limits.maxMinutes) return "time";
  if (costUsd(run) >= limits.maxCostUsd) return "cost";
  return undefined;
}

export function remainingMinutes(
  run: Run,
  limits: RunLimits,
  now: Date,
): number {
  return Math.max(0, limits.maxMinutes - workingMinutes(run.history, now));
}
