// Shared data for the configuration tests.
import { stringify } from "yaml";
import type { OrgBaseline } from "./schema.ts";

export const MINIMAL_CONFIG = {
  version: 1,
  commands: {
    install: "npm ci",
    test: "npm test",
    lint: "npm run lint",
    format: "npm run format",
  },
};

export const BASELINE: OrgBaseline = {
  version: 1,
  review: { max_rounds: 3 },
  gates: {
    static_analysis_fail_on: "error",
    sast_fail_on: "high",
    dependency_scan_fail_on: "high",
    coverage_drop_tolerance: 0,
    max_function_complexity: 10,
    max_duplication_percent: 3,
  },
  high_impact: { max_files: 10, max_changed_lines: 400, extra_paths: [] },
  limits: {
    stage_retries: 2,
    max_cost_usd_per_run: 10,
    max_minutes_per_run: 45,
    max_turns_per_stage: 50,
  },
  hooks: { deny_paths: [".github/**"] },
};

// The minimal configuration with whole top-level sections added or replaced.
export function configText(sections: Record<string, unknown> = {}): string {
  return stringify({ ...MINIMAL_CONFIG, ...sections });
}
