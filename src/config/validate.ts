import { parseRepoConfig } from "./parse.ts";
import {
  resolvePolicy,
  type EffectiveConfig,
  type Loosening,
} from "./policy.ts";
import type { OrgBaseline, RepoConfig } from "./schema.ts";

export type ValidationResult =
  | { ok: true; config: RepoConfig; effective: EffectiveConfig }
  | { ok: false; errors: string[] };

function describe({ path, value, baseline }: Loosening): string {
  return `${path}: ${JSON.stringify(value)} is looser than the organization baseline ${JSON.stringify(baseline)}`;
}

// A configuration is valid when it matches the schema and loosens no baseline field (FR-10.1, FR-10.2).
export function validateRepoConfig(
  text: string,
  baseline: OrgBaseline,
): ValidationResult {
  const parsed = parseRepoConfig(text);
  if (!parsed.ok) return parsed;
  const { effective, loosenings } = resolvePolicy(parsed.value, baseline);
  if (loosenings.length > 0) {
    return { ok: false, errors: loosenings.map(describe) };
  }
  return { ok: true, config: parsed.value, effective };
}
