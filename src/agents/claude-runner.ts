import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OrgBaseline } from "../config/schema.ts";
import { ROLE_TOOLS, type Role } from "../hooks/roles.ts";
import { toRoleResult, type ProcessRun } from "./claude-result.ts";
import type { RoleInput, RoleRunner } from "./role-runner.ts";
import type { RoleSettings } from "./roles-config.ts";
import { writeSessionFiles } from "./session-files.ts";

const MAX_STDERR = 4000;

// The only variables of the job that reach the session, so no GitHub or
// Actions token does (plan 3.2). The Claude token is set on its own.
const PASSED_ENV = ["PATH", "HOME", "LANG", "TMPDIR"] as const;

export interface ProcessSpec {
  command: string;
  args: readonly string[];
  // Written to standard input.
  input: string;
  env: Record<string, string>;
  cwd: string;
  signal: AbortSignal;
}

export type RunProcess = (spec: ProcessSpec) => Promise<ProcessRun>;

// Runs a process to its end and rejects when the signal kills it.
export const spawnProcess: RunProcess = (spec) =>
  new Promise((resolve, reject) => {
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      signal: spec.signal,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: string[] = [];
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout.push(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout: stdout.join(""), stderr });
    });
    // A process that exits before reading its input reports that itself.
    child.stdin.on("error", () => undefined);
    child.stdin.end(spec.input);
  });

// What a role needs from the runner: its prompt, the JSON Schema of its
// structured output and the role output built from that output.
export interface RoleSession {
  prompt(input: RoleInput, instructions: string): string;
  outputSchema: object;
  toOutput(structured: unknown): unknown;
}

export interface ClaudeRunnerOptions {
  // The checkout of the connected repository.
  workspace: string;
  // Where the session files go, outside the workspace.
  sessionsDir: string;
  // More directories of the job that sessions may not write, such as the
  // runner's temporary directory with the job's git directory.
  protect: readonly string[];
  baseline: OrgBaseline;
  token: string;
  sessions: Partial<Record<Role, RoleSession>>;
  settings: (role: Role) => Promise<RoleSettings>;
  runProcess: RunProcess;
  parentEnv: NodeJS.ProcessEnv;
}

interface Invocation {
  model: string;
  maxTurns: number;
  schema: object;
  settingsPath: string;
  tools: readonly string[];
}

// The flags of plan 3.4. The prompt comes on standard input, because one
// argument may not exceed 128 KiB on Linux.
export function claudeArgs(given: Invocation): string[] {
  return [
    "-p",
    "--model",
    given.model,
    "--max-turns",
    String(given.maxTurns),
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(given.schema),
    "--settings",
    given.settingsPath,
    "--setting-sources",
    "user",
    "--tools",
    ...given.tools,
    "--allowedTools",
    ...given.tools,
  ];
}

// The adapter of a role on Claude Code CLI in headless mode (spec 13.4,
// plan 3.4). Each attempt gets its own session directory with the hooks and
// the Claude Code configuration, written from the run's configuration copy.
export class ClaudeRoleRunner implements RoleRunner {
  private readonly options: ClaudeRunnerOptions;

  constructor(options: ClaudeRunnerOptions) {
    this.options = options;
  }

  async run(input: RoleInput, signal: AbortSignal): Promise<unknown> {
    const { options } = this;
    const session = options.sessions[input.role];
    if (session === undefined) {
      throw new Error(`No Claude Code session for the ${input.role} role.`);
    }
    const settings = await options.settings(input.role);
    const dir = path.join(
      options.sessionsDir,
      `${input.role}-${String(input.attempt)}`,
    );
    const files = await writeSessionFiles({
      role: input.role,
      workspace: options.workspace,
      configText: input.config,
      baseline: options.baseline,
      out: dir,
      protect: [options.sessionsDir, ...options.protect],
    });
    if (!files.ok) {
      throw new Error(`The run's configuration copy is invalid.`);
    }
    const configDir = path.join(dir, "claude-config");
    await mkdir(configDir, { recursive: true });
    const run = await options.runProcess({
      command: "claude",
      args: claudeArgs({
        model: settings.model,
        maxTurns: input.maxTurns,
        schema: session.outputSchema,
        settingsPath: files.files.settingsPath,
        tools: ROLE_TOOLS[input.role],
      }),
      input: session.prompt(input, settings.instructions),
      env: this.env(configDir),
      cwd: options.workspace,
      signal,
    });
    // For the session summary of the job; never a transcript (plan 4).
    await writeFile(path.join(dir, "result.json"), run.stdout);
    return toRoleResult(run, (structured) => session.toOutput(structured));
  }

  private env(configDir: string): Record<string, string> {
    const env: Record<string, string> = {
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_CODE_OAUTH_TOKEN: this.options.token,
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    };
    for (const name of PASSED_ENV) {
      const value = this.options.parentEnv[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }
}
