import type { RunEventRecord } from "../audit/run-events.ts";
import type { WorkflowRunsPort } from "../github/ports.ts";

const POLL_MS = 3_000;
const FORCE_AFTER_MS = 60_000;
const GIVE_UP_AFTER_MS = 240_000;

export interface WaitContext {
  runs: Pick<WorkflowRunsPort, "getRun" | "forceCancelRun">;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
}

// Waits until the cancelled workflow run has completed, so no write of it
// lands after the final state (plan 9). A run that ignores the cancellation
// is force-cancelled. The stop goes on after the deadline anyway, within the
// 5 minutes of NFR-4.28d; the check of FR-4.28c still blocks that run.
export async function waitUntilCompleted(
  context: WaitContext,
  id: number,
): Promise<string | undefined> {
  const start = context.now().getTime();
  let forced = false;
  for (;;) {
    const run = await context.runs.getRun(id);
    if (run.status === "completed") return context.now().toISOString();
    const elapsed = context.now().getTime() - start;
    if (elapsed >= GIVE_UP_AFTER_MS) return undefined;
    if (!forced && elapsed >= FORCE_AFTER_MS) {
      await context.runs.forceCancelRun(id);
      forced = true;
    }
    await context.wait(POLL_MS);
  }
}

// Side effects that passed their check before the stop and finished after it
// (FR-4.28c, FR-4.28f).
export function finishedAfter(
  events: readonly RunEventRecord[],
  labeledAt: string,
): string[] {
  const stop = Date.parse(labeledAt);
  return events
    .filter(
      (event) =>
        event.type === "side-effect" &&
        event.ended_at !== undefined &&
        Date.parse(event.ended_at) > stop,
    )
    .map((event) => {
      const effect = event.details?.effect;
      return typeof effect === "string" ? effect : "unknown";
    });
}
