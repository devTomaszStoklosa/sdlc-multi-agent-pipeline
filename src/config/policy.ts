import {
  SEVERITY_LEVELS,
  STATIC_ANALYSIS_LEVELS,
  type OrgBaseline,
  type PolicySection,
  type RepoConfig,
} from "./schema.ts";

export type EffectiveConfig = Omit<RepoConfig, PolicySection> &
  Omit<OrgBaseline, "version" | "limits"> & {
    limits: OrgBaseline["limits"] &
      Pick<RepoConfig["limits"], "comment_debounce_seconds">;
  };

export interface Loosening {
  path: string;
  value: unknown;
  baseline: unknown;
}

export interface ResolvedPolicy {
  effective: EffectiveConfig;
  loosenings: Loosening[];
}

interface FieldRule<T> {
  resolve(value: T | undefined, baseline: T): { value: T; loosened: boolean };
}

type SectionRules<S> = { [K in keyof S]-?: FieldRule<S[K]> };

// A lower rank is stricter. A looser value falls back to the baseline.
function ranked<T>(rank: (value: T) => number): FieldRule<T> {
  return {
    resolve(value, baseline) {
      if (value === undefined) return { value: baseline, loosened: false };
      if (rank(value) <= rank(baseline)) return { value, loosened: false };
      return { value: baseline, loosened: true };
    },
  };
}

const lowerIsStricter = ranked<number>((value) => value);

const byLevel = <T extends string>(levels: readonly T[]) =>
  ranked<T>((value) => levels.indexOf(value));

// A repository can only add entries to a baseline list.
const union: FieldRule<string[]> = {
  resolve(value, baseline) {
    return {
      value: [...new Set([...baseline, ...(value ?? [])])],
      loosened: false,
    };
  },
};

// One rule per baseline field. A new policy field fails to compile until it has a rule.
const POLICY_RULES: { [S in PolicySection]: SectionRules<OrgBaseline[S]> } = {
  review: { max_rounds: lowerIsStricter },
  gates: {
    static_analysis_fail_on: byLevel(STATIC_ANALYSIS_LEVELS),
    sast_fail_on: byLevel(SEVERITY_LEVELS),
    dependency_scan_fail_on: byLevel(SEVERITY_LEVELS),
    coverage_drop_tolerance: lowerIsStricter,
    max_function_complexity: lowerIsStricter,
    max_duplication_percent: lowerIsStricter,
  },
  high_impact: {
    max_files: lowerIsStricter,
    max_changed_lines: lowerIsStricter,
    extra_paths: union,
  },
  limits: {
    stage_retries: lowerIsStricter,
    max_cost_usd_per_run: lowerIsStricter,
    max_minutes_per_run: lowerIsStricter,
    max_turns_per_stage: lowerIsStricter,
  },
  hooks: {
    deny_paths: union,
    secret_paths: union,
    destructive_commands: union,
  },
};

class PolicyResolver {
  readonly loosenings: Loosening[] = [];

  section<S extends object>(
    name: PolicySection,
    repo: Partial<S> | undefined,
    baseline: S,
    rules: SectionRules<S>,
  ): S {
    const resolved: Partial<S> = {};
    for (const key of Object.keys(rules) as (keyof S & string)[]) {
      const result = rules[key].resolve(repo?.[key], baseline[key]);
      if (result.loosened) {
        this.loosenings.push({
          path: `${name}.${key}`,
          value: repo?.[key],
          baseline: baseline[key],
        });
      }
      resolved[key] = result.value;
    }
    return resolved as S;
  }
}

// Applies the organization baseline to a repository configuration. The result
// takes the stricter value of every policy field and lists every field the
// repository tried to loosen. Validation rejects any loosening (FR-10.2), while a
// run's saved copy is merged with the current baseline, so a baseline tightened
// during the run applies at once (FR-10.5).
export function resolvePolicy(
  repo: RepoConfig,
  baseline: OrgBaseline,
): ResolvedPolicy {
  const resolver = new PolicyResolver();
  const rules = POLICY_RULES;
  const effective: EffectiveConfig = {
    ...repo,
    review: resolver.section(
      "review",
      repo.review,
      baseline.review,
      rules.review,
    ),
    gates: resolver.section("gates", repo.gates, baseline.gates, rules.gates),
    high_impact: resolver.section(
      "high_impact",
      repo.high_impact,
      baseline.high_impact,
      rules.high_impact,
    ),
    limits: {
      ...resolver.section("limits", repo.limits, baseline.limits, rules.limits),
      comment_debounce_seconds: repo.limits.comment_debounce_seconds,
    },
    hooks: resolver.section("hooks", repo.hooks, baseline.hooks, rules.hooks),
    network: baseline.network,
  };
  return { effective, loosenings: resolver.loosenings };
}
