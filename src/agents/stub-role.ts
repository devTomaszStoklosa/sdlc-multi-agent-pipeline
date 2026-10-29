import { setTimeout as sleep } from "node:timers/promises";
import type {
  RoleInput,
  RoleOutput,
  RoleResult,
  RoleRunner,
} from "./role-runner.ts";
import { parseScenario, pick, type Scenario } from "./stub-scenario.ts";

type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

const waitFor: Wait = async (ms, signal) => {
  await sleep(ms, undefined, { signal });
};

function usage(scenario: Scenario): RoleResult["usage"] {
  return {
    input_tokens: 1000,
    output_tokens: 100,
    cost_usd: scenario.cost_usd,
    turns: 1,
  };
}

function planner(scenario: Scenario, input: RoleInput): RoleOutput {
  const version = input.planVersion + 1;
  const highImpact = pick(scenario.plans, version - 1) === "high-impact";
  const kind = highImpact ? "high-impact" : "zwykły";
  return {
    role: "planner",
    plan: {
      highImpact,
      text: `Plan zaślepki (P4), wersja ${String(version)}, ${kind}.`,
    },
  };
}

// A passing push writes formatted JSON, a failing one compact JSON, which the
// formatting gate rejects.
function developer(scenario: Scenario, input: RoleInput): RoleOutput {
  if (scenario.plan_update && input.pushes === 0 && input.planVersion === 1) {
    return {
      role: "developer",
      change: {
        kind: "plan-update",
        highImpact: true,
        text: "Zaślepka aktualizuje plan do zmiany high-impact (FR-4.11).",
      },
    };
  }
  const push = input.pushes + 1;
  const data = { run: input.runId, push };
  const fails = pick(scenario.gates, input.pushes) === "fail";
  return {
    role: "developer",
    change: {
      kind: "push",
      path: `stub-runs/issue-${String(input.issue.number)}.json`,
      content: fails
        ? JSON.stringify(data)
        : `${JSON.stringify(data, null, 2)}\n`,
      message: `chore: record stub push ${String(push)} of run ${input.runId} (#${String(input.issue.number)})`,
    },
  };
}

function reviewer(scenario: Scenario, input: RoleInput): RoleOutput {
  const verdict = pick(scenario.verdicts, input.reviewRound - 1) ?? "approve";
  const id = scenario.repeat_finding
    ? "stub-finding"
    : `stub-finding-${String(input.reviewRound)}`;
  const findings =
    verdict === "approve"
      ? []
      : [{ id, blocking: true, summary: "Znalezisko blokujące zaślepki." }];
  return { role: "reviewer", verdict, findings };
}

const OUTPUTS = { planner, developer, reviewer };

// Stub roles that return a ready result from the issue's scenario, so P4 runs
// the whole flow without a model and without the Pro plan's limits.
export class StubRoleRunner implements RoleRunner {
  private readonly wait: Wait;

  constructor(wait: Wait = waitFor) {
    this.wait = wait;
  }

  async run(input: RoleInput, signal: AbortSignal): Promise<RoleResult> {
    const parsed = parseScenario(input.issue.body);
    if (!parsed.ok) {
      return {
        status: "failed",
        failure: "infra",
        message: `Invalid stub scenario: ${parsed.error}`,
        usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0, turns: 0 },
      };
    }
    const { scenario } = parsed;
    await this.wait((scenario.delay_seconds[input.role] ?? 0) * 1000, signal);
    const failure = scenario.failures[input.role]?.[input.attempt - 1];
    if (failure !== undefined) {
      return {
        status: "failed",
        failure,
        message: `Stub ${input.role} failure ${failure} on attempt ${String(input.attempt)}.`,
        usage: usage(scenario),
        resetsAt:
          failure === "usage-limit"
            ? new Date(Date.now() + 3_600_000).toISOString()
            : undefined,
      };
    }
    const output = OUTPUTS[input.role](scenario, input);
    return { status: "ok", output, usage: usage(scenario) };
  }
}
