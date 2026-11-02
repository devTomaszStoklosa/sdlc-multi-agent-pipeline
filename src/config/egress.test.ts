import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { JOB_GROUPS, allowedEndpoints } from "./egress.ts";
import { parseOrgBaseline } from "./parse.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string): string =>
  readFileSync(new URL(path, root), "utf8");

const baseline = parseOrgBaseline(read("config/org-baseline.yml"));
if (!baseline.ok) throw new Error(baseline.errors.join("\n"));
const { network } = baseline.value;

interface Step {
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

interface Workflow {
  readonly jobs: Readonly<Record<string, { readonly steps?: Step[] }>>;
}

describe("allowedEndpoints", () => {
  it("allows GitHub to a job without groups", () => {
    const endpoints = allowedEndpoints([], { allowed_hosts: [] });

    expect(endpoints).toContain("github.com:443");
    expect(endpoints).not.toContain("registry.npmjs.org:443");
  });

  it("adds the hosts of the baseline once, sorted", () => {
    const endpoints = allowedEndpoints(["npm", "baseline"], {
      allowed_hosts: ["registry.npmjs.org", "a.example.org"],
    });

    expect(endpoints.filter((e) => e === "registry.npmjs.org:443")).toEqual([
      "registry.npmjs.org:443",
    ]);
    expect(endpoints).toContain("a.example.org:443");
    expect(endpoints).toEqual([...endpoints].sort());
  });

  it("allows the Anthropic API only with its group", () => {
    expect(allowedEndpoints(["npm"], network)).not.toContain(
      "api.anthropic.com:443",
    );
    expect(allowedEndpoints(["anthropic"], network)).toContain(
      "api.anthropic.com:443",
    );
  });
});

describe.each(Object.entries(JOB_GROUPS))("workflow %s", (file, jobs) => {
  const workflow = parse(read(`.github/workflows/${file}`)) as Workflow;

  it("lists the groups of every job", () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(Object.keys(jobs).sort());
  });

  it.each(Object.entries(jobs))(
    "blocks the traffic of %s outside its endpoints",
    (job, groups) => {
      const [first] = workflow.jobs[job]?.steps ?? [];

      expect(first?.uses).toMatch(
        /^step-security\/harden-runner@[0-9a-f]{40}$/,
      );
      expect(first?.with?.["egress-policy"]).toBe("block");
      expect(String(first?.with?.["disable-telemetry"])).toBe("true");
      const listed = String(first?.with?.["allowed-endpoints"]).split(/\s+/);
      expect(listed.filter(Boolean)).toEqual(allowedEndpoints(groups, network));
    },
  );
});
