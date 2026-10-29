// The composition root of the orchestrator jobs: GitHub clients from the
// tokens in the environment, the run store, the event log and the baseline.
import { appendFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  JsonlRunEventLog,
  parseRunEvents,
  type RunEventRecord,
} from "../audit/run-events.ts";
import { parseOrgBaseline } from "../config/parse.ts";
import type { OrgBaseline } from "../config/schema.ts";
import { CommentRunStateStore } from "../core/run-store/comment-store.ts";
import { createGitHub, type GitHub } from "../github/client.ts";
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

export async function wait(ms: number): Promise<void> {
  await sleep(ms);
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
