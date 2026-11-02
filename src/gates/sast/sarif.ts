import { z } from "zod";
import { SEVERITY_LEVELS } from "../../config/schema.ts";

export type Severity = (typeof SEVERITY_LEVELS)[number];

export interface Alert {
  // Identifies the alert across commits, so line shifts do not make it new.
  readonly key: string;
  readonly ruleId: string;
  readonly severity: Severity | undefined;
  readonly location: string;
}

const ruleSchema = z.object({
  id: z.string(),
  properties: z
    .object({ "security-severity": z.string().optional() })
    .optional(),
});

const componentSchema = z.object({ rules: z.array(ruleSchema).default([]) });

const resultSchema = z.object({
  ruleId: z.string().optional(),
  rule: z.object({ id: z.string().optional() }).optional(),
  partialFingerprints: z
    .object({ primaryLocationLineHash: z.string().optional() })
    .optional(),
  locations: z
    .array(
      z.object({
        physicalLocation: z
          .object({
            artifactLocation: z.object({ uri: z.string() }).optional(),
            region: z.object({ startLine: z.number() }).optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

const sarifSchema = z.object({
  runs: z.array(
    z.object({
      tool: z.object({
        driver: componentSchema,
        extensions: z.array(componentSchema).default([]),
      }),
      results: z.array(resultSchema).default([]),
    }),
  ),
});

type Run = z.infer<typeof sarifSchema>["runs"][number];
type Result = z.infer<typeof resultSchema>;

// The bands of GitHub code scanning for the CVSS-like score of a security
// query. A rule without the score is a quality rule, not a security one.
export function severityOf(score: string | undefined): Severity | undefined {
  const value = Number(score);
  if (score === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  if (value >= 9) return "critical";
  if (value >= 7) return "high";
  if (value >= 4) return "medium";
  return "low";
}

// CodeQL puts most rules in the query packs, the extensions of the tool.
function ruleScores(run: Run): Map<string, string | undefined> {
  const rules = [run.tool.driver, ...run.tool.extensions].flatMap(
    (component) => component.rules,
  );
  return new Map(
    rules.map((rule) => [rule.id, rule.properties?.["security-severity"]]),
  );
}

function primaryLocation(result: Result): { uri: string; line?: number } {
  const physical = result.locations[0]?.physicalLocation;
  return {
    uri: physical?.artifactLocation?.uri ?? "",
    line: physical?.region?.startLine,
  };
}

function toAlert(
  result: Result,
  scores: Map<string, string | undefined>,
): Alert {
  const ruleId = result.ruleId ?? result.rule?.id ?? "unknown";
  const { uri, line } = primaryLocation(result);
  const fingerprint =
    result.partialFingerprints?.primaryLocationLineHash ??
    `line:${String(line)}`;
  return {
    key: `${ruleId}|${uri}|${fingerprint}`,
    ruleId,
    severity: severityOf(scores.get(ruleId)),
    location: line === undefined ? uri : `${uri}:${String(line)}`,
  };
}

export function parseAlerts(sarifText: string): Alert[] {
  const sarif = sarifSchema.parse(JSON.parse(sarifText));
  return sarif.runs.flatMap((run) => {
    const scores = ruleScores(run);
    return run.results.map((result) => toAlert(result, scores));
  });
}

// QG-7.2: the security alerts of the head commit at the configured severity
// or above that the base commit does not have.
export function newAlerts(
  base: readonly Alert[],
  head: readonly Alert[],
  failOn: Severity,
): Alert[] {
  const known = new Set(base.map((alert) => alert.key));
  const threshold = SEVERITY_LEVELS.indexOf(failOn);
  return head.filter(
    (alert) =>
      alert.severity !== undefined &&
      SEVERITY_LEVELS.indexOf(alert.severity) >= threshold &&
      !known.has(alert.key),
  );
}
