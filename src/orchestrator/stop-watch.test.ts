import { describe, expect, it } from "vitest";
import { StubRoleRunner } from "../agents/stub-role.ts";
import { MemoryRunEventLog } from "../audit/run-events.ts";
import { FakeGitHub } from "../github/fake.ts";
import { RunInactiveError } from "./guard.ts";
import { runRoleJob } from "./role-job.ts";
import { watchForStop, type StopWatchScope } from "./stop-watch.ts";
import { AUTHOR, Harness } from "./test-harness.ts";

// A wait that runs a step of the test before each check.
function steps(...actions: (() => void)[]): StopWatchScope["wait"] {
  let call = 0;
  return () => {
    actions[call++]?.();
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  };
}

function scope(github: FakeGitHub, wait: StopWatchScope["wait"], pr?: number) {
  return {
    issues: github,
    pulls: github,
    log: new MemoryRunEventLog(),
    now: () => new Date("2026-10-29T10:00:00Z"),
    issue: 1,
    pr,
    runId: "1-1",
    workflowRunId: 5,
    intervalMs: 0,
    wait,
  };
}

async function aborted(signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) return signal.reason;
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => {
      resolve(signal.reason);
    });
  });
}

describe("watchForStop", () => {
  it("aborts the session when agent:stop appears on the issue", async () => {
    const github = new FakeGitHub();
    github.addIssue(1);
    const given = scope(
      github,
      steps(
        () => undefined,
        () => {
          github.label(1, "agent:stop", "author");
        },
      ),
    );
    const watch = watchForStop(given);
    const reason = await aborted(watch.signal);
    await watch.end();
    expect(reason).toBeInstanceOf(RunInactiveError);
    expect(given.log.records).toMatchObject([
      { type: "stop-detected", result: "the issue has agent:stop" },
    ]);
  });

  it.each([
    ["agent:stop", { labels: ["agent:stop"] }],
    ["closed", { state: "closed" as const }],
  ])(
    "aborts the session when the pull request is %s",
    async (_name, fields) => {
      const github = new FakeGitHub();
      github.addIssue(1);
      const pull = github.addPull({ number: 2 });
      const watch = watchForStop(
        scope(
          github,
          steps(() => Object.assign(pull, fields)),
          2,
        ),
      );
      expect(await aborted(watch.signal)).toBeInstanceOf(RunInactiveError);
      await watch.end();
    },
  );

  it("goes on after a failed check", async () => {
    const github = new FakeGitHub();
    github.addIssue(1);
    const getIssue = github.getIssue.bind(github);
    let calls = 0;
    github.getIssue = (issue) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("502"));
      github.label(1, "agent:stop", "author");
      return getIssue(issue);
    };
    const watch = watchForStop(scope(github, steps()));
    expect(await aborted(watch.signal)).toBeInstanceOf(RunInactiveError);
    await watch.end();
    expect(calls).toBe(2);
  });

  it("ends without aborting the session", async () => {
    const github = new FakeGitHub();
    github.addIssue(1);
    const watch = watchForStop(scope(github, steps()));
    await watch.end();
    expect(watch.signal.aborted).toBe(false);
  });
});

describe("a role job under the watch", () => {
  it("ends a long session at a stop, without side effects (NFR-4.28d)", async () => {
    const repo = new Harness();
    repo.setScenario(
      1,
      "plans: [high-impact]\ndelay_seconds:\n  developer: 600",
    );
    await repo.label(1, "agent:ready");
    const record = await repo.record(1);
    if (!record) throw new Error("no run");
    const run = {
      ...record.run,
      progress: { ...record.run.progress, state: "developing" as const },
      workflowRun: { id: 300, role: "developer" as const },
    };
    await repo.store.write({ ...record, run }, record.revision);
    const writes = repo.github.writes.length;
    // The session waits until something aborts it.
    const runner = new StubRoleRunner(
      (_ms, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const output = await runRoleJob(
      {
        ...repo.context(300),
        runner,
        stopWatch: {
          intervalMs: 0,
          wait: steps(() => {
            repo.github.label(1, "agent:stop", AUTHOR.login);
          }),
        },
      },
      1,
      "developer",
    );
    expect(output.status).toBe("skipped");
    expect(output.status === "skipped" && output.reason).toContain(
      "agent:stop",
    );
    expect(repo.github.writes.slice(writes)).toEqual([]);
  });
});
