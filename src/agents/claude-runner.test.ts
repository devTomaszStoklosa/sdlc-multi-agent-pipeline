import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { BASELINE, configText } from "../config/fixtures.ts";
import {
  ClaudeRoleRunner,
  type ProcessSpec,
  type RoleSession,
} from "./claude-runner.ts";
import type { RoleInput } from "./role-runner.ts";

const TOKEN = "claude-token";
const STDOUT = JSON.stringify({
  subtype: "success",
  is_error: false,
  num_turns: 2,
  structured_output: { plan: true },
});

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
  findings: [],
  attempt: 2,
  config: configText(),
  maxTurns: 30,
};

let sessionsDir = "";
let calls: ProcessSpec[] = [];

beforeEach(async () => {
  sessionsDir = await mkdtemp(path.join(tmpdir(), "claude-runner-"));
  calls = [];
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
      return Promise.resolve({ exitCode: 0, stdout: STDOUT, stderr: "" });
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
      "json",
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
    expect(await readFile(path.join(dir, "result.json"), "utf8")).toBe(STDOUT);
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
