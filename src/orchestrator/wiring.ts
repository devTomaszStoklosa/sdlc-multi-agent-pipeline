// The composition root of the orchestrator jobs: GitHub clients from the
// tokens in the environment, the run store, the event log and the baseline.
import { appendFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ClaudeRoleRunner, spawnProcess } from "../agents/claude-runner.ts";
import { developerSession } from "../agents/developer/session.ts";
import { plannerSession } from "../agents/planner/session.ts";
import type { RoleRunner } from "../agents/role-runner.ts";
import { loadRoleSettings } from "../agents/roles-config.ts";
import {
  JsonlRunEventLog,
  parseRunEvents,
  type RunEventRecord,
} from "../audit/run-events.ts";
import { parseOrgBaseline } from "../config/parse.ts";
import type { OrgBaseline } from "../config/schema.ts";
import { CommentRunStateStore } from "../core/run-store/comment-store.ts";
import { GitWorkspace } from "../git/git-workspace.ts";
import type { RunWorkspace } from "../git/workspace.ts";
import { createGitHub, type GitHub } from "../github/client.ts";
import {
  SandboxedCommandRunner,
  type CommandRunner,
} from "../hooks/commands.ts";
import type { JobContext } from "./context.ts";
import type { GitHubEvent } from "./filter.ts";

const BASELINE_PATH = fileURLToPath(
  new URL("../../config/org-baseline.yml", import.meta.url),
);

export function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`The environment variable ${name} is not set.`);
  }
  return value;
}

export async function githubEvent(): Promise<GitHubEvent> {
  const payload: unknown = JSON.parse(
    await readFile(env("GITHUB_EVENT_PATH"), "utf8"),
  );
  return { name: env("GITHUB_EVENT_NAME"), payload };
}

// Job outputs for the next jobs. A value must be one line.
export async function setOutputs(
  outputs: Record<string, string>,
): Promise<void> {
  const lines = Object.entries(outputs).map(([key, value]) => {
    if (value.includes("\n")) throw new Error(`Output ${key} has a newline.`);
    return `${key}=${value}\n`;
  });
  await appendFile(env("GITHUB_OUTPUT"), lines.join(""));
}

export function appId(): number {
  return Number(env("SDLC_APP_ID"));
}

// The ports of the token in an environment variable.
export function github(tokenVariable: string): GitHub {
  return createGitHub({
    token: env(tokenVariable),
    repository: env("GITHUB_REPOSITORY"),
    appId: appId(),
    baseUrl: process.env.GITHUB_API_URL,
  });
}

export async function loadBaseline(): Promise<OrgBaseline> {
  const parsed = parseOrgBaseline(await readFile(BASELINE_PATH, "utf8"));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

export interface Tokens {
  // The GitHub App token of the job, which writes.
  app: string;
  // The job's read-only workflow token, for the checks of FR-4.28c.
  read: string;
}

// The context of a job that writes the run state with its app token.
export async function jobContext(tokens: Tokens): Promise<JobContext> {
  const app = github(tokens.app);
  const read = github(tokens.read);
  return {
    repository: env("GITHUB_REPOSITORY"),
    app,
    read,
    store: new CommentRunStateStore(app.comments, appId()),
    log: new JsonlRunEventLog(env("SDLC_EVENTS_FILE")),
    baseline: await loadBaseline(),
    now: () => new Date(),
    workflowRunId: Number(env("GITHUB_RUN_ID")),
  };
}

// The roles on Claude Code. The job checks out the connected repository into
// SDLC_WORKSPACE and keeps the session files in SDLC_SESSIONS_DIR, outside it.
export async function claudeRunner(): Promise<RoleRunner> {
  return new ClaudeRoleRunner({
    workspace: env("SDLC_WORKSPACE"),
    sessionsDir: env("SDLC_SESSIONS_DIR"),
    protect: [env("RUNNER_TEMP")],
    baseline: await loadBaseline(),
    token: env("CLAUDE_CODE_OAUTH_TOKEN"),
    sessions: { planner: plannerSession, developer: developerSession },
    settings: loadRoleSettings,
    runProcess: spawnProcess,
    parentEnv: process.env,
  });
}

// The workspace of a Developer job. The job's git directory sits in the
// runner's temporary directory, which sessions may not write (plan 3.4).
// Commits name the app's bot user, from the slug that the token step gives.
export function gitWorkspace(): RunWorkspace {
  const bot = `${env("SDLC_APP_SLUG")}[bot]`;
  return new GitWorkspace({
    workspace: env("SDLC_WORKSPACE"),
    gitDir: path.join(env("RUNNER_TEMP"), "sdlc-git"),
    serverUrl: env("GITHUB_SERVER_URL"),
    token: env("SDLC_APP_TOKEN"),
    identity: { name: bot, email: `${bot}@users.noreply.github.com` },
    parentEnv: process.env,
  });
}

// The install command of a Developer job, in bubblewrap with the network and
// without the job's tokens (plan 3.4).
const INSTALL_TIMEOUT_MS = 10 * 60_000;

export function installer(): CommandRunner {
  return new SandboxedCommandRunner(
    env("SDLC_WORKSPACE"),
    INSTALL_TIMEOUT_MS,
    true,
  );
}

export async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  await sleep(ms, undefined, { signal });
}

// The run events in the artifacts of a workflow run, downloaded into a
// directory with one subdirectory per artifact.
export async function artifactEvents(
  dir: string | undefined,
): Promise<RunEventRecord[]> {
  if (dir === undefined || dir === "") return [];
  let files: string[];
  try {
    files = await readdir(dir, { recursive: true });
  } catch {
    return [];
  }
  const texts = await Promise.all(
    files
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => readFile(path.join(dir, file), "utf8")),
  );
  return texts.flatMap(parseRunEvents);
}
