import { readFile } from "node:fs/promises";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { BASELINE, MINIMAL_CONFIG, configText } from "./fixtures.ts";
import { parseOrgBaseline, parseRepoConfig } from "./parse.ts";

// The example from spec 10 with its placeholders filled in.
const SPEC_EXAMPLE = `
version: 1

commands:
  install: "npm ci"
  update_lockfile: "npm install --ignore-scripts"
  build: "npm run build"
  test: "npm test"
  lint: "npm run lint"
  format: "npm run format"
  coverage: "npm run coverage"

deploy:
  dev:
    command: "npm run deploy:dev"
    url: "https://pr-{number}.dev.example.com"
    health_check: "curl -f https://pr-{number}.dev.example.com/health"

review:
  max_rounds: 3

gates:
  static_analysis_fail_on: error
  sast_fail_on: high
  dependency_scan_fail_on: high
  coverage_drop_tolerance: 0
  max_function_complexity: 10
  max_duplication_percent: 3

high_impact:
  max_files: 10
  max_changed_lines: 400
  extra_paths:
    - "src/auth/**"

labels:
  ready: "agent:ready"
  needs_human: "needs-human"
  plan_approved: "plan:approved"

limits:
  stage_retries: 2
  comment_debounce_seconds: 60
  max_cost_usd_per_run: 20
  max_minutes_per_run: 120

hooks:
  deny_paths:
    - "infra/prod/**"
`;

function errorsOf(result: ReturnType<typeof parseRepoConfig>): string {
  if (result.ok) throw new Error("Expected the configuration to be rejected");
  return result.errors.join("\n");
}

describe("parseRepoConfig", () => {
  it("fills in the label and debounce defaults", () => {
    expect(parseRepoConfig(configText())).toEqual({
      ok: true,
      value: {
        ...MINIMAL_CONFIG,
        labels: {
          ready: "agent:ready",
          needs_human: "needs-human",
          plan_approved: "plan:approved",
        },
        limits: { comment_debounce_seconds: 60 },
      },
    });
  });

  it("accepts every field from the spec 10 example", () => {
    expect(parseRepoConfig(SPEC_EXAMPLE).ok).toBe(true);
  });

  it.each([
    ["a YAML syntax error", "version: 1\ncommands: [\n", "Flow sequence"],
    ["a duplicate key", `${configText()}version: 1\n`, "unique"],
    ["two documents", `${configText()}---\n${configText()}`, "multiple"],
    ["an empty file", "", "(root)"],
    ["an unsupported version", configText({ version: 2 }), "version"],
    [
      "a missing command",
      stringify({ version: 1, commands: { install: "npm ci", lint: "x" } }),
      "commands.test",
    ],
    [
      "an empty command",
      configText({ commands: { ...MINIMAL_CONFIG.commands, test: "" } }),
      "commands.test",
    ],
    [
      "an unknown top-level key",
      configText({ extra: true }),
      'Unrecognized key: "extra"',
    ],
    [
      "a misspelled policy field",
      configText({ review: { max_round: 2 } }),
      'review: Unrecognized key: "max_round"',
    ],
    [
      "an unknown limit",
      configText({ limits: { max_tokens: 1 } }),
      'limits: Unrecognized key: "max_tokens"',
    ],
    [
      "a configurable stop label (FR-10.4)",
      configText({ labels: { stop: "halt" } }),
      'labels: Unrecognized key: "stop"',
    ],
    [
      "a network allowlist (FR-10.2)",
      configText({ network: { allowed_hosts: ["example.com"] } }),
      'Unrecognized key: "network"',
    ],
    [
      "network hosts among the hooks (FR-10.2)",
      configText({ hooks: { allowed_hosts: ["example.com"] } }),
      'hooks: Unrecognized key: "allowed_hosts"',
    ],
    [
      "agent:stop as another label",
      configText({ labels: { ready: "agent:stop" } }),
      "labels.ready",
    ],
    [
      "two labels with the same name",
      configText({ labels: { ready: "go", plan_approved: "go" } }),
      "labels.plan_approved",
    ],
    [
      "a label longer than GitHub allows",
      configText({ labels: { needs_human: "x".repeat(51) } }),
      "labels.needs_human",
    ],
    [
      "a negated deny path",
      configText({ hooks: { deny_paths: ["!.github/**"] } }),
      "hooks.deny_paths.0",
    ],
    [
      "a negated secret path",
      configText({ hooks: { secret_paths: ["!.env.example"] } }),
      "hooks.secret_paths.0",
    ],
    [
      "an invalid destructive command pattern",
      configText({ hooks: { destructive_commands: ["(rm"] } }),
      "hooks.destructive_commands.0: Invalid regular expression",
    ],
    [
      "a negated high-impact path",
      configText({ high_impact: { extra_paths: ["!src/**"] } }),
      "high_impact.extra_paths.0",
    ],
    [
      "a number written as text",
      configText({ limits: { max_minutes_per_run: "45" } }),
      "limits.max_minutes_per_run",
    ],
    [
      "a fractional turn limit",
      configText({ limits: { max_turns_per_stage: 10.5 } }),
      "limits.max_turns_per_stage",
    ],
    [
      "negative retries",
      configText({ limits: { stage_retries: -1 } }),
      "limits.stage_retries",
    ],
    [
      "zero review rounds",
      configText({ review: { max_rounds: 0 } }),
      "review.max_rounds",
    ],
    [
      "duplication above 100%",
      configText({ gates: { max_duplication_percent: 101 } }),
      "gates.max_duplication_percent",
    ],
    [
      "an unknown severity",
      configText({ gates: { sast_fail_on: "severe" } }),
      "gates.sast_fail_on",
    ],
    [
      "a dev deployment without a command",
      configText({ deploy: { dev: { url: "https://dev.example.com" } } }),
      "deploy.dev.command",
    ],
  ])("rejects %s", (_reason, text, expected) => {
    expect(errorsOf(parseRepoConfig(text))).toContain(expected);
  });
});

describe("parseOrgBaseline", () => {
  it("accepts config/org-baseline.yml with the values from plan 2.2", async () => {
    const path = `${import.meta.dirname}/../../config/org-baseline.yml`;
    const result = parseOrgBaseline(await readFile(path, "utf8"));
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.value.high_impact).toMatchObject({
      max_files: 10,
      max_changed_lines: 400,
    });
    expect(result.value.limits.max_minutes_per_run).toBe(45);
    expect(result.value.hooks.deny_paths).toContain(".github/**");
    expect(result.value.hooks.secret_paths).toContain("**/.env");
    expect(result.value.network.allowed_hosts).toEqual(["registry.npmjs.org"]);
  });

  it("rejects an invalid host name", () => {
    const network = { allowed_hosts: ["https://example.com"] };
    const result = parseOrgBaseline(stringify({ ...BASELINE, network }));
    expect(result.ok ? "" : result.errors.join("\n")).toContain(
      "network.allowed_hosts.0: Invalid host name",
    );
  });

  it("rejects a baseline without a policy field", () => {
    // stringify drops undefined values, so the field is missing from the YAML.
    const limits = { ...BASELINE.limits, max_turns_per_stage: undefined };
    const result = parseOrgBaseline(stringify({ ...BASELINE, limits }));
    expect(result.ok ? "" : result.errors.join("\n")).toContain(
      "limits.max_turns_per_stage",
    );
  });
});
