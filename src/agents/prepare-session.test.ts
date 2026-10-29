import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { configText } from "../config/fixtures.ts";

const CLI = fileURLToPath(new URL("prepare-session.ts", import.meta.url));
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
];

let directory = "";
let configPath = "";

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "prepare-session-"));
  configPath = path.join(directory, ".sdlc-agents.yml");
  await writeFile(
    configPath,
    configText({ hooks: { deny_paths: ["infra/**"] } }),
  );
});

function prepare(args: string[]) {
  const result = spawnSync(process.execPath, [...NODE_FLAGS, CLI, ...args], {
    encoding: "utf8",
  });
  return { code: result.status, stderr: result.stderr };
}

const sessionArgs = (out: string, config = configPath) => [
  "--role",
  "developer",
  "--workspace",
  "/work/repo",
  "--config",
  config,
  "--out",
  out,
];

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

describe("prepare-session", () => {
  it("writes the hook context and the Claude Code settings", async () => {
    const out = path.join(directory, "session");
    expect(prepare(sessionArgs(out))).toMatchObject({ code: 0 });
    const contextPath = path.join(out, "hook-context.json");
    expect(await readJson(contextPath)).toMatchObject({
      role: "developer",
      workspace: "/work/repo",
      audit_log: path.join(out, "audit", "tool-calls.jsonl"),
      rules: {
        deny_paths: expect.arrayContaining([
          ".github/**",
          "infra/**",
        ]) as unknown,
        allowed_hosts: ["registry.npmjs.org"],
      },
      commands: { format: "npm run format", lint: "npm run lint" },
    });
    const settings = await readJson(path.join(out, "claude-settings.json"));
    expect(settings).toMatchObject({
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: process.execPath,
                args: expect.arrayContaining([
                  "pre-tool-use",
                  "--context",
                  contextPath,
                ]) as unknown,
                onFailure: "block",
              },
            ],
          },
        ],
      },
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        network: { allowedDomains: ["registry.npmjs.org"] },
        filesystem: { denyWrite: ["~/.claude", "~/.config", "~/.npmrc"] },
        credentials: {
          envVars: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", mode: "deny" }],
        },
      },
    });
    expect(Object.keys(settings as object)).toContain("hooks");
    expect(Object.keys((settings as { hooks: object }).hooks).sort()).toEqual([
      "PostToolUse",
      "PostToolUseFailure",
      "PreToolUse",
      "Stop",
    ]);
  });

  it("rejects an invalid configuration with exit code 1", async () => {
    const invalid = path.join(directory, "invalid.yml");
    await writeFile(
      invalid,
      configText({ limits: { max_minutes_per_run: 99 } }),
    );
    const result = prepare(sessionArgs(path.join(directory, "x"), invalid));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("max_minutes_per_run");
  });

  it.each([
    ["an unknown role", ["--role", "admin"]],
    ["a missing option", []],
  ])("rejects %s with exit code 2", (_name, args) => {
    expect(prepare(args).code).toBe(2);
  });

  it("rejects an output directory inside the workspace", () => {
    const args = sessionArgs(path.join(directory, "inside"));
    args[3] = directory;
    expect(prepare(args)).toMatchObject({ code: 2 });
  });
});
