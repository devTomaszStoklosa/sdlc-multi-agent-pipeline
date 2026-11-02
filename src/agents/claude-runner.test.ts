import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { BASELINE, configText } from "../config/fixtures.ts";
import type { ProcessRun } from "./claude-result.ts";
import {
  ClaudeRoleRunner,
  ProcessAbortedError,
  spawnProcess,
  type ProcessSpec,
  type RoleSession,
} from "./claude-runner.ts";
import { SessionAbortedError, type RoleInput } from "./role-runner.ts";

const TOKEN = "claude-token";
const RESULT = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 2,
  structured_output: { plan: true },
});
// A stream with the session's thinking, which the session directory never
// gets, and a system event after the result.
const STDOUT = [
  JSON.stringify({ type: "system", subtype: "init" }),
  JSON.stringify({
    type: "assistant",
    message: { id: "m1", content: [{ type: "thinking", thinking: "secret" }] },
  }),
  RESULT,
  JSON.stringify({ type: "system", subtype: "task_summary" }),
  "",
].join("\n");

let processRun: (spec: ProcessSpec) => Promise<ProcessRun> = () =>
  Promise.resolve({ exitCode: 0, stdout: STDOUT, stderr: "" });

const session: RoleSession = {
  prompt: (input, instructions) =>
    `${instructions} #${String(input.issue.number)}`,
  outputSchema: { type: "object" },
  toOutput: (structured) => ({ role: "planner", plan: structured }),
};

const input: RoleInput = {
  role: "planner",
  issue: { number: 12, title: "T", body: "B" },
  runId: "12-1",
  planVersion: 0,
  reviewRound: 0,
  pushes: 0,
  attempt: 2,
  config: configText(),
  maxTurns: 30,
};

let sessionsDir = "";
let calls: ProcessSpec[] = [];

beforeEach(async () => {
  sessionsDir = await mkdtemp(path.join(tmpdir(), "claude-runner-"));
  calls = [];
  processRun = () =>
    Promise.resolve({ exitCode: 0, stdout: STDOUT, stderr: "" });
});

function runner(
  sessions: Partial<Record<string, RoleSession>> = { planner: session },
) {
  return new ClaudeRoleRunner({
    workspace: "/work/repo",
    sessionsDir,
    protect: ["/work/_temp"],
    baseline: BASELINE,
    token: TOKEN,
    sessions,
    settings: () =>
      Promise.resolve({ model: "claude-test", instructions: "Plan it." }),
    runProcess: (spec) => {
      calls.push(spec);
      return processRun(spec);
    },
    parentEnv: {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      SDLC_APP_TOKEN: "app-token",
      SDLC_READ_TOKEN: "read-token",
      GITHUB_TOKEN: "workflow-token",
      ACTIONS_RUNTIME_TOKEN: "runtime-token",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token",
    },
  });
}

describe("ClaudeRoleRunner", () => {
  it("runs claude -p with the role's model, tools, limits and settings", async () => {
    const result = await runner().run(input, new AbortController().signal);
    expect(result).toMatchObject({
      status: "ok",
      output: { role: "planner", plan: { plan: true } },
    });
    const [call] = calls;
    const dir = path.join(sessionsDir, "planner-2");
    expect(call?.command).toBe("claude");
    expect(call?.args).toEqual([
      "-p",
      "--model",
      "claude-test",
      "--max-turns",
      "30",
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      '{"type":"object"}',
      "--settings",
      path.join(dir, "claude-settings.json"),
      "--setting-sources",
      "user",
      "--tools",
      "Read",
      "Grep",
      "Glob",
      "--allowedTools",
      "Read",
      "Grep",
      "Glob",
    ]);
    expect(call?.input).toBe("Plan it. #12");
    expect(call?.cwd).toBe("/work/repo");
    expect(await readFile(path.join(dir, "result.json"), "utf8")).toBe(RESULT);
  });

  it("reports the usage of an aborted session from its stream (#61)", async () => {
    const message = (id: string, output: number) =>
      JSON.stringify({
        type: "assistant",
        message: {
          id,
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 1000,
            output_tokens: output,
          },
        },
      });
    const stream = [message("m1", 1), message("m1", 5), message("m2", 7)];
    processRun = () =>
      Promise.reject(new ProcessAbortedError(stream.join("\n")));
    const usage = {
      input_tokens: 2204,
      output_tokens: 12,
      cost_usd: 0,
      turns: 2,
    };
    const run = runner().run(input, new AbortController().signal);
    await expect(run).rejects.toEqual(new SessionAbortedError(usage));
    await expect(run).rejects.toMatchObject({ usage });
    const summary = JSON.parse(
      await readFile(
        path.join(sessionsDir, "planner-2", "result.json"),
        "utf8",
      ),
    ) as unknown;
    expect(summary).toEqual({
      subtype: "aborted",
      num_turns: 2,
      usage: { input_tokens: 2204, output_tokens: 12 },
      partial_usage: true,
    });
  });

  // Shell commands of the session run next to these directories in the
  // runner's home directory, which the sandbox does not protect by itself.
  it("denies the session writes to the pipeline, the sessions and the job's files", async () => {
    await runner().run(input, new AbortController().signal);
    const settings = JSON.parse(
      await readFile(
        path.join(sessionsDir, "planner-2", "claude-settings.json"),
        "utf8",
      ),
    ) as { sandbox: { filesystem: { denyWrite: string[] } } };
    expect(settings.sandbox.filesystem.denyWrite).toEqual([
      "~/.claude",
      "~/.config",
      "~/.npmrc",
      path.resolve(fileURLToPath(new URL("../../", import.meta.url))),
      path.join(sessionsDir, "planner-2"),
      path.resolve(sessionsDir),
      path.resolve("/work/_temp"),
    ]);
  });

  it("passes the Claude token but no GitHub or Actions token", async () => {
    await runner().run(input, new AbortController().signal);
    expect(calls[0]?.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/runner",
      CLAUDE_CONFIG_DIR: path.join(sessionsDir, "planner-2", "claude-config"),
      CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  });

  it("tells the hooks which planned manifests to install, if configured", async () => {
    const withManifests: RoleSession = {
      ...session,
      manifests: () => ["package.json"],
    };
    const contextOf = async (config: string) => {
      await runner({ planner: withManifests }).run(
        { ...input, config },
        new AbortController().signal,
      );
      const file = path.join(sessionsDir, "planner-2", "hook-context.json");
      return JSON.parse(await readFile(file, "utf8")) as {
        dependencies?: unknown;
      };
    };
    const commands = {
      install: "npm ci",
      update_lockfile: "npm install --ignore-scripts",
      test: "npm test",
      lint: "npm run lint",
      format: "npm run format",
    };
    expect((await contextOf(configText({ commands }))).dependencies).toEqual({
      command: "npm install --ignore-scripts",
      manifests: ["package.json"],
    });
    expect((await contextOf(configText())).dependencies).toBeUndefined();
  });

  it("refuses a role without a session and an invalid configuration copy", async () => {
    const signal = new AbortController().signal;
    await expect(runner({}).run(input, signal)).rejects.toThrow(
      "No Claude Code session for the planner role.",
    );
    await expect(
      runner().run({ ...input, config: "version: 2" }, signal),
    ).rejects.toThrow("configuration copy is invalid");
    expect(calls).toEqual([]);
  });
});

describe("spawnProcess", () => {
  it("keeps the output of a process that the signal kills (#61)", async () => {
    const controller = new AbortController();
    const run = spawnProcess({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('event\\n'); setInterval(() => undefined, 1000);",
      ],
      input: "",
      env: { PATH: process.env.PATH ?? "" },
      cwd: tmpdir(),
      signal: controller.signal,
    });
    setTimeout(() => {
      controller.abort();
    }, 1000);
    await expect(run).rejects.toEqual(new ProcessAbortedError("event\n"));
    await expect(run).rejects.toMatchObject({ stdout: "event\n" });
  });
});
