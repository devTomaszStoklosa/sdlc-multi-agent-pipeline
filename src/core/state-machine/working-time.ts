import { isWorking, type RunStateName } from "./states.ts";

export interface StateEntry {
  state: RunStateName;
  at: string;
}

const MS_PER_MINUTE = 60_000;

// Minutes the run spent in working states, from the transitions recorded in
// its state (NFR-11.5). Waiting states do not count, because their length
// depends on people and on capacity, not on the run's work. The last entry
// lasts until `now`.
export function workingMinutes(
  history: readonly StateEntry[],
  now: Date,
): number {
  let total = 0;
  history.forEach((entry, index) => {
    if (!isWorking(entry.state)) return;
    const end = history[index + 1]?.at ?? now.toISOString();
    total += Math.max(0, Date.parse(end) - Date.parse(entry.at));
  });
  return total / MS_PER_MINUTE;
}
