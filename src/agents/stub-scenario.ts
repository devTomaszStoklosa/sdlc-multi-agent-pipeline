import { parseDocument } from "yaml";
import { z } from "zod";
import { ROLES } from "../hooks/roles.ts";
import { ROLE_FAILURES } from "./role-runner.ts";

const MAX_DELAY_SECONDS = 2400;
const BLOCK = /<!-- sdlc-stub\n([\s\S]*?)\n-->/;

// How the stub roles of P4 behave on an issue. Each list gives the outcome of
// the first, second and later occurrence; the last entry repeats.
const scenarioSchema = z.strictObject({
  plans: z
    .array(z.enum(["normal", "high-impact"]))
    .min(1)
    .default(["normal"]),
  // The Developer's first stage updates the first plan to high-impact (FR-4.11).
  plan_update: z.literal("high-impact").optional(),
  // Pushes that fail or pass the gates, through the formatting gate.
  gates: z
    .array(z.enum(["pass", "fail"]))
    .min(1)
    .default(["pass"]),
  verdicts: z
    .array(z.enum(["approve", "changes_requested"]))
    .min(1)
    .default(["approve"]),
  // Every `changes_requested` reports the same finding (FR-4.18).
  repeat_finding: z.boolean().default(false),
  // Failed attempts of a stage, by role (FR-4.30).
  failures: z
    .partialRecord(z.enum(ROLES), z.array(z.enum(ROLE_FAILURES)))
    .default({}),
  // A role session that takes this long, to stop a run during a role job.
  delay_seconds: z
    .partialRecord(
      z.enum(ROLES),
      z.number().int().min(0).max(MAX_DELAY_SECONDS),
    )
    .default({}),
  cost_usd: z.number().min(0).default(0.01),
});

export type Scenario = z.infer<typeof scenarioSchema>;

export type ScenarioResult =
  { ok: true; scenario: Scenario } | { ok: false; error: string };

// The scenario is a hidden YAML block in the issue body. An issue without it
// gets the default: a normal plan, passing gates and `approve`.
export function parseScenario(issueBody: string): ScenarioResult {
  const text = BLOCK.exec(issueBody.replaceAll("\r\n", "\n"))?.[1] ?? "{}";
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      ok: false,
      error: document.errors.map((e) => e.message).join("; "),
    };
  }
  const parsed = scenarioSchema.safeParse(document.toJS() ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, scenario: parsed.data };
}

// The entry for the n-th occurrence, counted from 0.
export function pick<T>(entries: readonly T[], index: number): T | undefined {
  return entries[Math.min(index, entries.length - 1)];
}
