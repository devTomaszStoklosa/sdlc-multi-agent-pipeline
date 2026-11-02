import { z } from "zod";

export interface GateResult {
  readonly passed: boolean;
  readonly message: string;
}

// The total of an istanbul `json-summary` report, which Vitest, Jest, nyc and
// c8 write as coverage/coverage-summary.json.
const summarySchema = z.object({
  total: z.object({ lines: z.object({ pct: z.number() }) }),
});

export function linePct(summaryText: string): number {
  return summarySchema.parse(JSON.parse(summaryText)).total.lines.pct;
}

// QG-7.6: line coverage of a pull request must not drop below its base commit
// by more than the tolerance in percentage points. A base without coverage,
// such as a commit before the tests, has nothing to compare with.
export function checkCoverage(
  basePct: number | undefined,
  headPct: number,
  tolerance: number,
): GateResult {
  if (basePct === undefined) {
    return {
      passed: true,
      message: `No base coverage to compare with. Head line coverage: ${String(headPct)}%.`,
    };
  }
  const drop = basePct - headPct;
  return {
    passed: drop <= tolerance,
    message: `Line coverage: base ${String(basePct)}%, head ${String(headPct)}%, allowed drop ${String(tolerance)} pp.`,
  };
}
