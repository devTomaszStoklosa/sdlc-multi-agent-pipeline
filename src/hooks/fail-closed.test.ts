import { describe, expect, it } from "vitest";
import { failClosed, runFailClosed } from "./fail-closed.ts";

const TOKEN = ["sk", "ant", "oat01", "Abc123_def-456ghi789jkl"].join("-");
const POST_INPUT = JSON.stringify({
  tool_response: { stdout: TOKEN, stderr: "", interrupted: false },
});

describe("failClosed (SEC-9.0a)", () => {
  it("blocks a tool call", () => {
    const response = failClosed("PreToolUse", "", new Error("boom"));
    expect(response.exitCode).toBe(2);
    expect(response.stderr).toContain("boom");
  });

  it("withholds the tool output and keeps its shape", () => {
    const response = failClosed("PostToolUse", POST_INPUT, new Error("boom"));
    const answer = JSON.parse(response.stdout ?? "") as {
      hookSpecificOutput: { updatedToolOutput: Record<string, unknown> };
    };
    expect(answer.hookSpecificOutput.updatedToolOutput).toEqual({
      stdout: expect.stringContaining("withheld") as unknown,
      stderr: expect.stringContaining("withheld") as unknown,
      interrupted: false,
    });
    expect(response.stdout).not.toContain(TOKEN);
  });

  it("blocks with exit code 2 when the output cannot be read", () => {
    expect(failClosed("PostToolUse", "{", new Error("boom")).exitCode).toBe(2);
  });

  it("refuses to stop", () => {
    const response = failClosed("Stop", "", new Error("boom"));
    expect(JSON.parse(response.stdout ?? "")).toMatchObject({
      decision: "block",
    });
  });

  it("redacts secrets in the error message", () => {
    const response = failClosed("PreToolUse", "", new Error(TOKEN));
    expect(response.stderr).not.toContain(TOKEN);
  });
});

describe("runFailClosed", () => {
  it("returns the handler's answer", async () => {
    const answer = { exitCode: 0, stdout: "{}" };
    const response = await runFailClosed(
      "PreToolUse",
      "",
      () => Promise.resolve(answer),
      1000,
    );
    expect(response).toEqual(answer);
  });

  it("fails closed when the handler throws", async () => {
    const response = await runFailClosed(
      "PreToolUse",
      "",
      () => Promise.reject(new Error("invalid input")),
      1000,
    );
    expect(response).toMatchObject({ exitCode: 2 });
  });

  it("fails closed when the handler misses its deadline", async () => {
    const response = await runFailClosed(
      "PreToolUse",
      "",
      () => new Promise(() => undefined),
      10,
    );
    expect(response.stderr).toContain("no answer within 10 ms");
  });
});
