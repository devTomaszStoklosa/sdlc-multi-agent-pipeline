// The entry point of the orchestrator jobs in the reusable workflows.
// Usage: orchestrator <command> [--issue <n>] [--role <role>]
// Commands: filter, scopes, decide, role, advance, target, cancel, wait-run,
// finalize.
// Tokens and paths come from the environment, never from arguments, so they
// do not appear in the process list. Exit codes: 0 done, 1 failed, 2 usage.
import { parseArgs } from "node:util";
import type { RoleRunner } from "../agents/role-runner.ts";
import { StubRoleRunner } from "../agents/stub-role.ts";
import { JsonlRunEventLog } from "../audit/run-events.ts";
import { CommentRunStateStore } from "../core/run-store/comment-store.ts";
import { isRole, type Role } from "../hooks/roles.ts";
import { advance } from "./advance.ts";
import { decide } from "./decide.ts";
import { filterEvent } from "./filter.ts";
import { runRoleJob } from "./role-job.ts";
import { roleJobOutputSchema } from "./role-output.ts";
import { STOP_WATCH_MS } from "./stop-watch.ts";
import {
  ORCHESTRATOR_SCOPE,
  ROLE_SCOPES,
  TERMINATE_SCOPE,
  scopeOutputs,
} from "./scopes.ts";
import { cancelActiveRun, finalize } from "./terminate.ts";
import { waitUntilCompleted } from "./terminal-runs.ts";
import {
  resolveTarget,
  terminalTargetSchema,
  type TerminalTarget,
} from "./terminal-target.ts";
import {
  appId,
  artifactEvents,
  claudeRunner,
  env,
  github,
  githubEvent,
  gitWorkspace,
  installer,
  jobContext,
  loadBaseline,
  setOutputs,
  wait,
} from "./wiring.ts";

interface Args {
  command: string;
  issue: number;
  role: string;
}

function args(argv: readonly string[]): Args {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { issue: { type: "string" }, role: { type: "string" } },
  });
  return {
    command: positionals[0] ?? "",
    issue: Number(values.issue ?? "0"),
    role: values.role ?? "",
  };
}

function roleOf(given: Args): Role {
  if (!isRole(given.role)) throw new Error(`Unknown role: ${given.role}`);
  return given.role;
}

const TOKENS = { app: "SDLC_APP_TOKEN", read: "SDLC_READ_TOKEN" };

async function filter(): Promise<void> {
  const result = filterEvent(await githubEvent(), env("GITHUB_REPOSITORY"));
  console.log(
    result.proceed ? `Issue #${String(result.issue)}` : result.reason,
  );
  await setOutputs({
    proceed: String(result.proceed),
    issue: result.proceed ? String(result.issue) : "",
  });
}

async function scopes(given: Args): Promise<void> {
  const scope =
    given.role === "orchestrator"
      ? ORCHESTRATOR_SCOPE
      : given.role === "terminate"
        ? TERMINATE_SCOPE
        : ROLE_SCOPES[roleOf(given)];
  await setOutputs(scopeOutputs(scope));
}

async function decideCommand(given: Args): Promise<void> {
  const context = await jobContext(TOKENS);
  const result = await decide(
    { ...context, gatesWorkflow: env("SDLC_GATES_WORKFLOW") },
    given.issue,
    await githubEvent(),
  );
  console.log(`Role to start: ${result.role ?? "none"}`);
  await setOutputs({ role: result.role ?? "" });
}

const stub = () => Promise.resolve(new StubRoleRunner());

// The Planner and the Developer run on Claude Code; the Reviewer stays a stub
// until P7.
const RUNNERS: Record<Role, () => Promise<RoleRunner>> = {
  planner: claudeRunner,
  developer: claudeRunner,
  reviewer: stub,
};

// The role job reads the state with its read-only token and writes none.
async function roleCommand(given: Args): Promise<void> {
  const role = roleOf(given);
  const context = await jobContext(TOKENS);
  const read = github(TOKENS.read);
  const store = new CommentRunStateStore(read.comments, appId());
  const output = await runRoleJob(
    {
      ...context,
      store,
      runner: await RUNNERS[role](),
      stopWatch: { intervalMs: STOP_WATCH_MS, wait },
      appId: appId(),
      workspace: gitWorkspace(),
      installer: installer(),
      gatesWorkflow: env("SDLC_GATES_WORKFLOW"),
    },
    given.issue,
    role,
  );
  console.log(`Role job: ${output.status}`);
  await setOutputs({ output: JSON.stringify(output) });
}

async function advanceCommand(given: Args): Promise<void> {
  const text = process.env.SDLC_ROLE_OUTPUT ?? "";
  const output =
    text === "" ? undefined : roleJobOutputSchema.parse(JSON.parse(text));
  const result = await advance(await jobContext(TOKENS), given.issue, output);
  console.log(`Next role: ${result.role ?? "none"}`);
  await setOutputs({ role: result.role ?? "" });
}

async function target(): Promise<void> {
  const result = resolveTarget(await githubEvent(), env("GITHUB_REPOSITORY"));
  console.log(
    result.ok ? `Issue #${String(result.target.issue)}` : result.reason,
  );
  await setOutputs({
    proceed: String(result.ok),
    issue: result.ok ? String(result.target.issue) : "",
    target: result.ok ? JSON.stringify(result.target) : "",
  });
}

function terminalTarget(): TerminalTarget {
  return terminalTargetSchema.parse(JSON.parse(env("SDLC_TARGET")));
}

function base() {
  return {
    log: new JsonlRunEventLog(env("SDLC_EVENTS_FILE")),
    now: () => new Date(),
    workflowRunId: Number(env("GITHUB_RUN_ID")),
  };
}

// The workflow token of the cancel job may cancel runs and read issues.
async function cancel(): Promise<void> {
  const actions = github("SDLC_ACTIONS_TOKEN");
  const store = new CommentRunStateStore(actions.comments, appId());
  const id = await cancelActiveRun(
    { ...base(), store, runs: actions.runs },
    terminalTarget(),
  );
  console.log(
    id === undefined ? "Nothing to cancel" : `Cancelled run ${String(id)}`,
  );
  await setOutputs({ cancelled: id === undefined ? "" : String(id) });
}

async function waitRun(): Promise<void> {
  const read = github(TOKENS.read);
  const id = Number(env("SDLC_CANCELLED"));
  const completedAt = await waitUntilCompleted(
    { runs: read.runs, now: () => new Date(), wait },
    id,
  );
  console.log(
    completedAt === undefined
      ? `Run ${String(id)} is still running`
      : `Run ${String(id)} completed at ${completedAt}`,
  );
}

async function finalizeCommand(): Promise<void> {
  const app = github(TOKENS.app);
  const read = github(TOKENS.read);
  const cancelled = process.env.SDLC_CANCELLED ?? "";
  await finalize(
    {
      ...base(),
      store: new CommentRunStateStore(app.comments, appId()),
      app,
      runs: read.runs,
      baseline: await loadBaseline(),
      events: await artifactEvents(process.env.SDLC_ARTIFACTS_DIR),
      wait,
    },
    terminalTarget(),
    cancelled === "" ? undefined : Number(cancelled),
  );
}

const COMMANDS: Record<string, (given: Args) => Promise<void>> = {
  filter,
  scopes,
  decide: decideCommand,
  role: roleCommand,
  advance: advanceCommand,
  target,
  cancel,
  "wait-run": waitRun,
  finalize: finalizeCommand,
};

async function main(argv: readonly string[]): Promise<number> {
  const given = args(argv);
  const command = COMMANDS[given.command];
  if (command === undefined) {
    console.error(`Usage: orchestrator <${Object.keys(COMMANDS).join("|")}>`);
    return 2;
  }
  try {
    await command(given);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
