import { describe, expect, it } from "vitest";
import type { ToolCallRecord } from "../../audit/tool-log.ts";
import type { CommandResult, CommandRunner } from "../commands.ts";
import { hookContext } from "../fixtures.ts";
import { BASE_POLICIES } from "../policies/index.ts";
import { REDACTED } from "../redact.ts";
import type { Role } from "../roles.ts";
import type { HookDependencies } from "./dependencies.ts";
import {
  handlePostToolUse,
  handlePostToolUseFailure,
} from "./post-tool-use.ts";
import { handlePreToolUse } from "./pre-tool-use.ts";
import { handleStop } from "./stop.ts";

const TOKEN = ["sk", "ant", "oat01", "Abc123_def-456ghi789jkl"].join("-");
const NOW = new Date("2026-10-29T10:00:00.000Z");

class FakeRunner implements CommandRunner {
  readonly calls: [string, readonly string[]][] = [];
  private readonly failing: ReadonlySet<string>;

  constructor(failing: readonly string[] = []) {
    this.failing = new Set(failing);
  }

  run(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push([command, args]);
    const ok = !this.failing.has(command);
    return Promise.resolve({ ok, output: ok ? "" : `error near ${TOKEN}` });
  }
}

function dependencies(runner = new FakeRunner()) {
  const records: ToolCallRecord[] = [];
  const deps: HookDependencies = {
    log: {
      append: (record) => {
        records.push(record);
        return Promise.resolve();
      },
    },
    runner,
    now: () => NOW,
  };
  return { deps, records, runner };
}

const toolEvent = (tool_name: string, tool_input: Record<string, unknown>) => ({
  hook_event_name: "PreToolUse" as const,
  session_id: "s1",
  tool_name,
  tool_input,
});

const postEvent = (
  tool_name: string,
  tool_input: Record<string, unknown>,
  tool_response: unknown,
) => ({
  ...toolEvent(tool_name, tool_input),
  hook_event_name: "PostToolUse" as const,
  tool_response,
  duration_ms: 40,
});

describe("handlePreToolUse", () => {
  it("lets an allowed call through without an answer or a log entry", async () => {
    const { deps, records } = dependencies();
    const event = toolEvent("Bash", { command: "npm test" });
    const response = await handlePreToolUse(
      event,
      hookContext(),
      deps,
      BASE_POLICIES,
    );
    expect(response).toEqual({ exitCode: 0 });
    expect(records).toEqual([]);
  });

  it("blocks with exit code 2 and logs the block with its category", async () => {
    const { deps, records } = dependencies();
    const event = toolEvent("Bash", { command: `git push && echo ${TOKEN}` });
    const response = await handlePreToolUse(
      event,
      hookContext(),
      deps,
      BASE_POLICIES,
    );
    expect(response.exitCode).toBe(2);
    expect(response.stderr).toContain("may not push");
    expect(records).toEqual([
      expect.objectContaining({
        time: NOW.toISOString(),
        session: "s1",
        role: "developer",
        tool: "Bash",
        input: `git push && echo ${REDACTED}`,
        decision: "denied",
        blocks: [expect.objectContaining({ category: "protected-branch" })],
      }),
    ]);
  });
});

describe("handlePostToolUse", () => {
  it("redacts the output and logs the call", async () => {
    const { deps, records } = dependencies();
    const output = { stdout: `TOKEN=${TOKEN}`, stderr: "", interrupted: false };
    const event = postEvent("Bash", { command: "cat x" }, output);
    const response = await handlePostToolUse(event, hookContext(), deps);
    expect(JSON.parse(response.stdout ?? "")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: { ...output, stdout: `TOKEN=${REDACTED}` },
      },
    });
    expect(records).toEqual([
      expect.objectContaining({
        decision: "allowed",
        duration_ms: 40,
        redactions: 1,
      }),
    ]);
  });

  it("leaves clean output unchanged", async () => {
    const { deps } = dependencies();
    const event = postEvent("Read", { file_path: "src/a.ts" }, { file: "x" });
    const response = await handlePostToolUse(event, hookContext(), deps);
    expect(JSON.parse(response.stdout ?? "")).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse" },
    });
  });

  it("formats and lints a written file, in that order", async () => {
    const { deps, runner } = dependencies();
    const event = postEvent("Edit", { file_path: "src/a.ts" }, {});
    await handlePostToolUse(event, hookContext(), deps);
    const { format, lint } = hookContext().commands;
    expect(runner.calls).toEqual([
      [format, ["src/a.ts"]],
      [lint, ["src/a.ts"]],
    ]);
  });

  it("sends linter errors back to the agent, redacted", async () => {
    const context = hookContext();
    const { deps } = dependencies(new FakeRunner([context.commands.lint]));
    const event = postEvent("Write", { file_path: "src/a.ts" }, {});
    const answer = JSON.parse(
      (await handlePostToolUse(event, context, deps)).stdout ?? "",
    ) as { decision: string; reason: string };
    expect(answer.decision).toBe("block");
    expect(answer.reason).toContain("linter");
    expect(answer.reason).not.toContain(TOKEN);
  });
});

describe("handlePostToolUseFailure", () => {
  it("logs the failed call", async () => {
    const { deps, records } = dependencies();
    const event = {
      ...toolEvent("Bash", { command: "npm test" }),
      hook_event_name: "PostToolUseFailure" as const,
    };
    await handlePostToolUseFailure(event, hookContext(), deps);
    expect(records).toEqual([expect.objectContaining({ decision: "failed" })]);
  });
});

const STOP = { session_id: "session-1" };

describe("handleStop", () => {
  it("lets the Developer finish when lint and tests pass", async () => {
    const { deps, runner, records } = dependencies();
    expect(await handleStop(STOP, hookContext(), deps)).toEqual({
      exitCode: 0,
    });
    expect(records).toEqual([
      expect.objectContaining({
        session: "session-1",
        tool: "Stop",
        input: "lint, test",
        decision: "allowed",
      }),
    ]);
    const { lint, test } = hookContext().commands;
    expect(runner.calls).toEqual([
      [lint, []],
      [test, []],
    ]);
  });

  it("refuses to let the Developer finish with failing tests (QG-9.12)", async () => {
    const context = hookContext();
    const { deps, records } = dependencies(
      new FakeRunner([context.commands.test]),
    );
    const answer = JSON.parse(
      (await handleStop(STOP, context, deps)).stdout ?? "",
    ) as {
      decision: string;
      reason: string;
    };
    expect(answer.decision).toBe("block");
    expect(answer.reason).toContain(context.commands.test);
    expect(answer.reason).not.toContain(TOKEN);
    expect(records).toEqual([
      expect.objectContaining({
        tool: "Stop",
        decision: "denied",
        blocks: [
          { policy: "stage-gates", category: "quality", reason: "test failed" },
        ],
      }),
    ]);
  });

  it.each<Role>(["planner", "reviewer"])(
    "runs no gates for the %s",
    async (role) => {
      const { deps, runner } = dependencies();
      expect(await handleStop(STOP, hookContext(role), deps)).toEqual({
        exitCode: 0,
      });
      expect(runner.calls).toEqual([]);
    },
  );
});
