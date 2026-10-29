import { parseDocument } from "yaml";
import type { z } from "zod";
import {
  orgBaselineSchema,
  repoConfigSchema,
  type OrgBaseline,
  type RepoConfig,
} from "./schema.ts";

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; errors: string[] };

// Duplicate keys are YAML errors, so a second key cannot silently override the first.
function parseYaml<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return { ok: false, errors: document.errors.map((error) => error.message) };
  }
  const result = schema.safeParse(document.toJS());
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map(formatIssue) };
  }
  return { ok: true, value: result.data };
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join(".");
  return `${path || "(root)"}: ${issue.message}`;
}

export function parseRepoConfig(text: string): ParseResult<RepoConfig> {
  return parseYaml(text, repoConfigSchema);
}

export function parseOrgBaseline(text: string): ParseResult<OrgBaseline> {
  return parseYaml(text, orgBaselineSchema);
}
