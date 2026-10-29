import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { hookContext } from "./fixtures.ts";

const CLI = fileURLToPath(new URL("cli.ts", import.meta.url));
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
];

let directory = "";
let contextPath = "";

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hook-cli-"));
  contextPath = path.join(directory, "hook-context.json");
  const context = {
    ...hookContext(),
    audit_log: path.join(directory, "tool-calls.jsonl"),
  };
  await writeFile(contextPath, JSON.stringify(context));
});

function runHook(args: string[], input: unknown) {
  const result = spawnSync(process.execPath, [...NODE_FLAGS, CLI, ...args], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const preToolUse = (command: string) => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command },
  tool_use_id: "t1",
});

describe("hook command line", () => {
  it("lets an allowed call through", () => {
    const result = runHook(
      ["pre-tool-use", "--context", contextPath],
      preToolUse("npm test"),
    );
    expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
  });

  it("blocks a denied call with exit code 2 and logs it", async () => {
    const result = runHook(
      ["pre-tool-use", "--context", contextPath],
      preToolUse("printenv"),
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("environment variables");
    const log = await readFile(
      path.join(directory, "tool-calls.jsonl"),
      "utf8",
    );
    expect(log).toContain('"decision":"denied"');
  });

  it.each([
    ["invalid JSON input", ["pre-tool-use", "--context"], "{"],
    ["input of another event", ["pre-tool-use", "--context"], { a: 1 }],
    [
      "a missing context file",
      ["pre-tool-use", "--context", "missing.json"],
      {},
    ],
    ["an unknown event", ["pre-everything", "--context"], {}],
    ["no context flag", ["pre-tool-use"], {}],
  ])("blocks on %s (SEC-9.0a)", (_name, args, input) => {
    const fullArgs = args.length === 2 ? [...args, contextPath] : args;
    expect(runHook(fullArgs, input).code).toBe(2);
  });

  it("withholds the tool output when the post hook fails", () => {
    const result = runHook(["post-tool-use", "--context", "missing.json"], {
      tool_response: { stdout: "original output", stderr: "" },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("withheld");
    expect(result.stdout).not.toContain("original output");
  });
});
