import { describe, expect, it } from "vitest";
import {
  SessionAbortedError,
  type RoleRunner,
  type RoleUsage,
} from "../agents/role-runner.ts";
import { MemoryRunEventLog } from "../audit/run-events.ts";
import { RunInactiveError } from "./guard.ts";
import { session } from "./stage-session.ts";

const PARTIAL: RoleUsage = {
  input_tokens: 2204,
  output_tokens: 12,
  cost_usd: 0,
  turns: 2,
};

// A session that runs until the signal ends it, with the usage of its stream.
const untilAborted: RoleRunner = {
  run: (_input, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(new SessionAbortedError(PARTIAL));
      });
    }),
};

const input = {
  role: "developer" as const,
  issue: { number: 1, title: "T", body: "B" },
  runId: "1-1",
  planVersion: 1,
  reviewRound: 0,
  pushes: 0,
  config: "version: 1\n",
  maxTurns: 30,
};

function context() {
  return {
    runner: untilAborted,
    log: new MemoryRunEventLog(),
    now: () => new Date("2026-10-29T10:00:00Z"),
    workflowRunId: 7,
  };
}

const PARTIAL_EVENT = {
  type: "stage-attempt",
  agent: "developer",
  tokens: { input: 2204, output: 12 },
  details: { attempt: 1, partial: true },
};

describe("an aborted stage session (#61)", () => {
  it("logs the partial usage of a stopped session and ends the job", async () => {
    const given = context();
    const stop = new AbortController();
    const ran = session(given, input, {
      retries: 2,
      minutes: 10,
      stop: stop.signal,
    });
    const reason = new RunInactiveError("session", "agent:stop on #1");
    stop.abort(reason);
    await expect(ran).rejects.toBe(reason);
    expect(given.log.records).toEqual([
      expect.objectContaining({ ...PARTIAL_EVENT, result: "stopped" }),
    ]);
    expect(given.log.records[0]).not.toHaveProperty("cost_usd");
  });

  it("counts the partial usage of a timed-out session towards the run's", async () => {
    const given = context();
    const ran = await session(given, input, {
      retries: 2,
      minutes: 0.0001,
      stop: new AbortController().signal,
    });
    expect(ran).toEqual({ timedOut: true, attempts: 1, usage: PARTIAL });
    expect(given.log.records).toEqual([
      expect.objectContaining({ ...PARTIAL_EVENT, result: "timed-out" }),
    ]);
  });
});
