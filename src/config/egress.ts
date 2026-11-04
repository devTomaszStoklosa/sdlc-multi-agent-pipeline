import type { OrgBaseline } from "./schema.ts";

// Outbound hosts of the pipeline's jobs (SEC-8.4, SEC-9.0c). Every job starts
// with harden-runner in block mode, whose allowed-endpoints list is the union
// of the groups below. The lists were recorded in audit mode on the demo
// repository (#68). A job's list stays literal in its workflow, so a review
// sees it; egress.test.ts keeps each list equal to allowedEndpoints().

const HTTPS = 443;
const HTTP = 80;

interface Endpoint {
  readonly host: string;
  readonly port: number;
}

const https = (host: string): Endpoint => ({ host, port: HTTPS });

// The runner itself and GitHub: checkout, the API, logs, artifacts, caches,
// release downloads of actions and the upload of code scanning results. The
// storage account and the compute hosts change with the region, hence the
// wildcards; *.blob.core.windows.net also matches other Azure accounts.
const github: readonly Endpoint[] = [
  "github.com",
  "api.github.com",
  "uploads.github.com",
  "broker.actions.githubusercontent.com",
  "results-receiver.actions.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "*.blob.core.windows.net",
  "*.githubapp.com",
].map(https);

// The pipeline's own npm dependencies, whatever the baseline allows.
const npm: readonly Endpoint[] = [https("registry.npmjs.org")];

const anthropic: readonly Endpoint[] = [https("api.anthropic.com")];

// apt-get in agent-setup: the Ubuntu mirror of the runner image is plain HTTP.
const apt: readonly Endpoint[] = [
  { host: "azure.archive.ubuntu.com", port: HTTP },
  https("azure.archive.ubuntu.com"),
  https("esm.ubuntu.com"),
  https("motd.ubuntu.com"),
  https("packages.microsoft.com"),
];

// The OpenSSF Scorecard of the dependencies in dependency-review, and deps.dev,
// which the action asks about the packages of a pull request that changes
// dependencies (devTomaszStoklosa/Parapka#17).
const scorecard: readonly Endpoint[] = [
  https("api.deps.dev"),
  https("api.securityscorecards.dev"),
];

const FIXED_GROUPS = { npm, anthropic, apt, scorecard } as const;

// "baseline" stands for network.allowed_hosts of the organization baseline:
// the hosts that the repository's commands and the agent's tools may reach.
export type EndpointGroup = keyof typeof FIXED_GROUPS | "baseline";

// The groups of each job beyond GitHub, by workflow file and job id.
export const JOB_GROUPS: Readonly<
  Record<string, Readonly<Record<string, readonly EndpointGroup[]>>>
> = {
  "orchestrate.yml": {
    filter: ["npm"],
    decide: ["npm"],
    role: ["npm", "apt", "anthropic", "baseline"],
    advance: ["npm"],
    "role-2": ["npm", "apt", "anthropic", "baseline"],
    "advance-2": ["npm"],
  },
  "gates.yml": {
    config: ["npm"],
    format: ["npm", "baseline"],
    lint: ["npm", "baseline"],
    build: ["npm", "baseline"],
    test: ["npm", "baseline"],
    coverage: ["npm", "baseline"],
    duplication: ["npm"],
    secrets: [],
    commitlint: ["npm"],
    "dependency-review": ["scorecard"],
    "sast-head": [],
    "sast-base": [],
    sast: ["npm"],
  },
  "scope-gate.yml": { scope: ["npm"] },
  "terminate.yml": { cancel: ["npm"], finalize: ["npm"] },
  "agent-trial.yml": { trial: ["npm", "apt", "anthropic", "baseline"] },
};

function groupEndpoints(
  group: EndpointGroup,
  network: OrgBaseline["network"],
): readonly Endpoint[] {
  return group === "baseline"
    ? network.allowed_hosts.map(https)
    : FIXED_GROUPS[group];
}

// The sorted, distinct host:port entries of a job with the given groups.
export function allowedEndpoints(
  groups: readonly EndpointGroup[],
  network: OrgBaseline["network"],
): string[] {
  const endpoints = [github, ...groups.map((g) => groupEndpoints(g, network))];
  const entries = endpoints
    .flat()
    .map(({ host, port }) => `${host}:${String(port)}`);
  return [...new Set(entries)].sort();
}
