import { describe, expect, it } from "vitest";
import { BASELINE } from "../config/fixtures.ts";
import {
  ACTIVE_STATES,
  roleOf,
  type ActiveState,
} from "../core/state-machine/states.ts";
import { AGENT_REVIEW } from "./role-effects.ts";
import { runRoleJob } from "./role-job.ts";
import { cancelActiveRun, finalize } from "./terminate.ts";
import type { TerminalTarget } from "./terminal-target.ts";
import { AUTHOR, Harness, REPO } from "./test-harness.ts";

const STOP_RUN = 500;
const ROLE_RUN = 400;

// A run with a pull request, moved into the given state while workflow run
// ROLE_RUN works on it.
async function runIn(state: ActiveState): Promise<Harness> {
  const repo = new Harness();
  await repo.label(1, "agent:ready");
  repo.github.label(1, "plan:approved", AUTHOR.login);
  const record = await repo.record(1);
  if (!record) throw new Error("no run");
  repo.github.addRun(ROLE_RUN, { name: "Orchestrate" });
  const run = {
    ...record.run,
    progress: { ...record.run.progress, state },
    workflowRun: { id: ROLE_RUN, role: roleOf(state) },
  };
  await repo.store.write({ ...record, run }, record.revision);
  if (state === "reviewing" && run.progress.pushedSha) {
    await repo.github.startCheckRun(AGENT_REVIEW, run.progress.pushedSha);
  }
  return repo;
}

interface Clock {
  now: () => Date;
  wait: (ms: number) => Promise<void>;
}

async function terminate(
  repo: Harness,
  target: TerminalTarget,
  clock: Clock = { now: () => repo.now(), wait: () => Promise.resolve() },
): Promise<void> {
  const base = { log: repo.log, now: clock.now, workflowRunId: STOP_RUN };
  const github = repo.github.ports();
  const cancelled = await cancelActiveRun(
    { ...base, store: repo.store, runs: github.runs },
    target,
  );
  await finalize(
    {
      ...base,
      store: repo.store,
      app: github,
      runs: github.runs,
      baseline: BASELINE,
      events: repo.log.records,
      wait: clock.wait,
    },
    target,
    cancelled,
  );
}

async function stop(repo: Harness, where: "issue" | "pr"): Promise<void> {
  const pr = (await repo.run(1)).pr;
  const target = where === "pr" ? pr : 1;
  if (target === undefined) throw new Error("no pull request");
  repo.github.label(target, "agent:stop", AUTHOR.login);
  await terminate(repo, {
    kind: "stop",
    issue: 1,
    where,
    pr: where === "pr" ? pr : undefined,
    actor: AUTHOR.login,
  });
}

async function close(repo: Harness, merged: boolean): Promise<void> {
  const pr = (await repo.run(1)).pr;
  if (pr === undefined) throw new Error("no pull request");
  const pull = repo.github.pulls.get(pr);
  if (pull) Object.assign(pull, { state: "closed", merged });
  await terminate(repo, {
    kind: "close",
    issue: 1,
    where: "pr",
    pr,
    actor: AUTHOR.login,
    merged,
  });
}

function summaries(repo: Harness): string[] {
  return repo.comments(1).filter((body) => body.includes("zatrzymany"));
}

describe.each(ACTIVE_STATES)("a run in %s", (state) => {
  it.each(["issue", "pr"] as const)(
    "stops on agent:stop on the %s (QG-12.3a)",
    async (where) => {
      const repo = await runIn(state);
      await stop(repo, where);
      const run = await repo.run(1);
      expect(run.progress.state).toBe("stopped");
      expect(run.stop).toMatchObject({ by: "author", where });
      expect(repo.github.issues.get(1)?.labels).not.toContain("agent:ready");
      expect(repo.github.issues.get(1)?.labels).not.toContain("plan:approved");
      expect(summaries(repo)).toHaveLength(1);
      expect(summaries(repo)[0]).toContain(`\`${state}\``);
      expect(repo.github.runs.get(ROLE_RUN)?.status).toBe("completed");
      const checks = [...repo.github.checkRuns.values()].filter(
        (check) => check.status === "in_progress",
      );
      expect(checks).toEqual([]);
    },
  );

  it("publishes one summary when agent:stop goes on the issue and the pull request", async () => {
    const repo = await runIn(state);
    await stop(repo, "issue");
    await stop(repo, "pr");
    expect(summaries(repo)).toHaveLength(1);
    expect(repo.log.records.at(-1)).toMatchObject({ type: "stop-ignored" });
  });

  it.each([true, false])(
    "ends as done when the pull request closes, merged: %s (FR-4.35)",
    async (merged) => {
      const repo = await runIn(state);
      await close(repo, merged);
      const run = await repo.run(1);
      expect(run.progress.state).toBe("done");
      expect(run.end).toMatchObject({ state: "done", merged });
      expect(repo.github.issues.get(1)?.labels).toEqual([]);
      expect(summaries(repo)).toEqual([]);
      expect(repo.log.records.at(-1)).toMatchObject({
        type: "close",
        stage: state,
      });
    },
  );
});

describe("after the end of a run", () => {
  it("only logs a pull request closed after a stop (FR-4.28)", async () => {
    const repo = await runIn("awaiting-human-review");
    await stop(repo, "issue");
    await close(repo, true);
    expect(await repo.state(1)).toBe("stopped");
    expect(repo.log.records.at(-1)).toMatchObject({
      type: "close-ignored",
      result: "the run is already stopped",
    });
  });

  it("has no side effects of the cancelled run's later jobs", async () => {
    const repo = await runIn("developing");
    await stop(repo, "issue");
    const writes = repo.github.writes.length;
    const context = repo.context(ROLE_RUN);
    expect(await runRoleJob(context, 1, "developer")).toMatchObject({
      status: "skipped",
    });
    expect(repo.github.writes.slice(writes)).toEqual([]);
  });

  it.each([
    [
      "on the open pull request after agent:stop is removed",
      async (repo: Harness) => {
        await stop(repo, "issue");
        await repo.github.removeLabel(1, "agent:stop");
      },
      "chore/1-stub-run",
    ],
    [
      "on a new branch after the pull request closed unmerged",
      (repo: Harness) => close(repo, false),
      "chore/1-stub-run-2",
    ],
  ])("starts a new run %s (FR-4.28b)", async (_name, end, branch) => {
    const repo = await runIn("gating");
    await end(repo);
    expect(await repo.label(1, "agent:ready")).toEqual([
      "planner",
      "developer",
    ]);
    const run = await repo.run(1);
    expect(run.id).toBe("1-2");
    expect(run.branch).toBe(branch);
  });

  it("refuses agent:ready while the open pull request has agent:stop", async () => {
    const repo = await runIn("gating");
    await stop(repo, "pr");
    expect(await repo.label(1, "agent:ready")).toEqual([]);
    expect(repo.comments(1).at(-1)).toContain("Zdejmij najpierw");
  });
});

describe("a stop", () => {
  it("works with an invalid .sdlc-agents.yml on main (FR-10.4)", async () => {
    const repo = await runIn("developing");
    repo.commitToMain("this is: [not valid");
    await stop(repo, "issue");
    expect(await repo.state(1)).toBe("stopped");
  });

  it("ignores agent:stop on a pull request that is not the run's", async () => {
    const repo = await runIn("developing");
    repo.github.addPull({
      number: 77,
      headRef: "feat/1-other",
      headRepo: REPO,
    });
    await terminate(repo, {
      kind: "stop",
      issue: 1,
      where: "pr",
      pr: 77,
      actor: AUTHOR.login,
    });
    expect(await repo.state(1)).toBe("developing");
  });

  it("names a side effect that finished after the label in the summary", async () => {
    const repo = await runIn("developing");
    repo.log.records.push({
      time: "2026-10-29T10:00:05Z",
      type: "side-effect",
      issue: 1,
      started_at: "2026-10-29T09:59:59Z",
      ended_at: "2026-10-29T10:00:05Z",
      details: { effect: "push" },
    });
    await stop(repo, "issue");
    expect(summaries(repo)[0]).toContain("dokończone po zatrzymaniu: push");
  });

  it("force-cancels a workflow run that ignores the cancellation", async () => {
    const repo = await runIn("developing");
    repo.github.onCancel = () => undefined;
    let clock = repo.now().getTime();
    repo.github.label(1, "agent:stop", AUTHOR.login);
    await terminate(
      repo,
      { kind: "stop", issue: 1, where: "issue", actor: "author" },
      {
        now: () => new Date(clock),
        wait: (ms) => {
          clock += ms;
          return Promise.resolve();
        },
      },
    );
    expect(repo.github.runs.get(ROLE_RUN)?.conclusion).toBe("cancelled");
    expect(await repo.state(1)).toBe("stopped");
  });
});
