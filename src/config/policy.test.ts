import { describe, expect, it } from "vitest";
import { BASELINE, MINIMAL_CONFIG } from "./fixtures.ts";
import { resolvePolicy } from "./policy.ts";
import {
  orgBaselineSchema,
  repoConfigSchema,
  type PolicySection,
} from "./schema.ts";

// Two valid values of every scalar policy field; the first one is stricter.
const POLICY_FIELDS = [
  ["review.max_rounds", 2, 3],
  ["gates.static_analysis_fail_on", "warning", "error"],
  ["gates.sast_fail_on", "medium", "high"],
  ["gates.dependency_scan_fail_on", "high", "critical"],
  ["gates.coverage_drop_tolerance", 0, 0.5],
  ["gates.max_function_complexity", 8, 10],
  ["gates.max_duplication_percent", 2.5, 3],
  ["high_impact.max_files", 5, 10],
  ["high_impact.max_changed_lines", 200, 400],
  ["limits.stage_retries", 0, 2],
  ["limits.max_cost_usd_per_run", 5, 10],
  ["limits.max_minutes_per_run", 30, 45],
  ["limits.max_turns_per_stage", 40, 50],
] as const;

function split(path: string): [PolicySection, string] {
  const [section, key = ""] = path.split(".");
  return [section as PolicySection, key];
}

function repoWith(path: string, value: unknown) {
  const [section, key] = split(path);
  return repoConfigSchema.parse({
    ...MINIMAL_CONFIG,
    [section]: { [key]: value },
  });
}

function baselineWith(path: string, value: unknown) {
  const [section, key] = split(path);
  return orgBaselineSchema.parse({
    ...BASELINE,
    [section]: { ...BASELINE[section], [key]: value },
  });
}

function fieldOf(config: object, path: string): unknown {
  const [section, key] = split(path);
  return (config as Record<string, Record<string, unknown>>)[section]?.[key];
}

describe("resolvePolicy", () => {
  it("covers every scalar baseline field in the tests below", () => {
    const scalarPaths = Object.entries(BASELINE).flatMap(([section, fields]) =>
      typeof fields === "object"
        ? Object.entries(fields)
            .filter(([, value]) => !Array.isArray(value))
            .map(([key]) => `${section}.${key}`)
        : [],
    );
    expect(POLICY_FIELDS.map(([path]) => path).sort()).toEqual(
      scalarPaths.sort(),
    );
  });

  it.each(POLICY_FIELDS)("reports a looser %s", (path, stricter, looser) => {
    const { effective, loosenings } = resolvePolicy(
      repoWith(path, looser),
      baselineWith(path, stricter),
    );
    expect(loosenings).toEqual([{ path, value: looser, baseline: stricter }]);
    expect(fieldOf(effective, path)).toBe(stricter);
  });

  it.each(POLICY_FIELDS)("uses a stricter %s", (path, stricter, looser) => {
    const { effective, loosenings } = resolvePolicy(
      repoWith(path, stricter),
      baselineWith(path, looser),
    );
    expect(loosenings).toEqual([]);
    expect(fieldOf(effective, path)).toBe(stricter);
  });

  it("accepts values equal to the baseline", () => {
    const repo = repoConfigSchema.parse({ ...MINIMAL_CONFIG, ...BASELINE });
    const { effective, loosenings } = resolvePolicy(repo, BASELINE);
    expect(loosenings).toEqual([]);
    expect(effective).toMatchObject(BASELINE);
  });

  it("takes missing policy fields from the baseline", () => {
    const repo = repoConfigSchema.parse(MINIMAL_CONFIG);
    const { effective } = resolvePolicy(repo, BASELINE);
    expect(effective).toEqual({
      ...repo,
      ...BASELINE,
      limits: { ...BASELINE.limits, comment_debounce_seconds: 60 },
    });
  });

  it("adds repository paths to the baseline lists without duplicates", () => {
    const repo = repoConfigSchema.parse({
      ...MINIMAL_CONFIG,
      high_impact: { extra_paths: ["src/auth/**"] },
      hooks: { deny_paths: ["infra/prod/**", ".github/**"] },
    });
    const { effective, loosenings } = resolvePolicy(repo, BASELINE);
    expect(loosenings).toEqual([]);
    expect(effective.high_impact.extra_paths).toEqual(["src/auth/**"]);
    expect(effective.hooks.deny_paths).toEqual([".github/**", "infra/prod/**"]);
  });
});

describe("resolvePolicy with a run's saved copy (FR-10.5)", () => {
  const field = "limits.max_minutes_per_run";
  const copy = repoWith(field, 40);

  it("applies a baseline tightened during the run", () => {
    expect(resolvePolicy(copy, BASELINE).loosenings).toEqual([]);
    const tightened = baselineWith(field, 30);
    expect(fieldOf(resolvePolicy(copy, tightened).effective, field)).toBe(30);
  });

  it("keeps the copy's stricter value when the baseline is loosened", () => {
    const loosened = baselineWith(field, 60);
    expect(fieldOf(resolvePolicy(copy, loosened).effective, field)).toBe(40);
  });

  it("takes a field missing from the copy from the current baseline", () => {
    const repo = repoConfigSchema.parse(MINIMAL_CONFIG);
    const loosened = baselineWith(field, 60);
    expect(fieldOf(resolvePolicy(repo, loosened).effective, field)).toBe(60);
  });
});
