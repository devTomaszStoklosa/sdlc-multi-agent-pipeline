import { z } from "zod";

// Severity thresholds, from the strictest to the most lenient one.
export const STATIC_ANALYSIS_LEVELS = ["warning", "error"] as const;
export const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;

// The stop label is fixed, so stopping never depends on the configuration (FR-10.4).
export const STOP_LABEL = "agent:stop";

const MAX_LABEL_LENGTH = 50;

const count = (min: number) => z.number().int().min(min);
const command = z.string().min(1);
// A negated pattern could exclude a path that the baseline adds.
const pathPattern = z
  .string()
  .min(1)
  .refine((pattern) => !pattern.startsWith("!"), {
    message: "Negated path patterns are not allowed",
  });

// Policy sections. The baseline sets every field; a repository may only tighten them.
const reviewPolicy = z.strictObject({ max_rounds: count(1) });

const gatesPolicy = z.strictObject({
  static_analysis_fail_on: z.enum(STATIC_ANALYSIS_LEVELS),
  sast_fail_on: z.enum(SEVERITY_LEVELS),
  dependency_scan_fail_on: z.enum(SEVERITY_LEVELS),
  coverage_drop_tolerance: z.number().min(0),
  max_function_complexity: count(1),
  max_duplication_percent: z.number().min(0).max(100),
});

const highImpactPolicy = z.strictObject({
  max_files: count(1),
  max_changed_lines: count(1),
  extra_paths: z.array(pathPattern),
});

const limitsPolicy = z.strictObject({
  stage_retries: count(0),
  max_cost_usd_per_run: z.number().positive(),
  max_minutes_per_run: count(1),
  max_turns_per_stage: count(1),
});

// Network hosts are not here: only the baseline may allow new ones (FR-10.2).
const hooksPolicy = z.strictObject({ deny_paths: z.array(pathPattern) });

export const orgBaselineSchema = z.strictObject({
  version: z.literal(1),
  review: reviewPolicy,
  gates: gatesPolicy,
  high_impact: highImpactPolicy,
  limits: limitsPolicy,
  hooks: hooksPolicy,
});

const commands = z.strictObject({
  install: command,
  build: command.optional(),
  test: command,
  lint: command,
  format: command,
  coverage: command.optional(),
});

const deploy = z.strictObject({
  dev: z.strictObject({
    command,
    url: z.string().min(1),
    health_check: command.optional(),
  }),
});

const labelName = z.string().min(1).max(MAX_LABEL_LENGTH);

// No `stop` key: the stop label is not configurable (FR-10.4).
const labels = z
  .strictObject({
    ready: labelName.default("agent:ready"),
    needs_human: labelName.default("needs-human"),
    plan_approved: labelName.default("plan:approved"),
  })
  .superRefine((names, context) => {
    const seen = new Set<string>([STOP_LABEL]);
    for (const [key, name] of Object.entries(names)) {
      if (seen.has(name)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `Label "${name}" is already used by another label or by ${STOP_LABEL}`,
        });
      }
      seen.add(name);
    }
  });

export const repoConfigSchema = z.strictObject({
  version: z.literal(1),
  commands,
  deploy: deploy.optional(),
  review: reviewPolicy.partial().optional(),
  gates: gatesPolicy.partial().optional(),
  high_impact: highImpactPolicy.partial().optional(),
  labels: labels.prefault({}),
  limits: limitsPolicy
    .partial()
    .extend({ comment_debounce_seconds: count(0).default(60) })
    .prefault({}),
  hooks: hooksPolicy.partial().optional(),
});

export type OrgBaseline = z.infer<typeof orgBaselineSchema>;
export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type PolicySection = Exclude<keyof OrgBaseline, "version">;
