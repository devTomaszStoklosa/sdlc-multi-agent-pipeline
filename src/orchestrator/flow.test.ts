import { describe, expect, it } from "vitest";
import { Harness, REPO } from "./test-harness.ts";

describe("a run on stub roles", () => {
  it("goes from agent:ready to awaiting-human-review", async () => {
    const repo = new Harness();
    repo.setScenario(
      1,
      "gates: [fail, pass]\nverdicts: [changes_requested, approve]",
    );
    expect(await repo.label(1, "agent:ready")).toEqual([
      "planner",
      "developer",
    ]);
    expect(await repo.state(1)).toBe("gating");
    expect(await repo.gates(1, "failure")).toEqual(["developer"]);
    expect(await repo.gates(1, "success")).toEqual(["reviewer", "developer"]);
    expect(await repo.gates(1, "success")).toEqual(["reviewer"]);
    expect(await repo.states(1)).toEqual([
      "queued",
      "planning",
      "developing",
      "gating",
      "developing",
      "gating",
      "reviewing",
      "developing",
      "gating",
      "reviewing",
      "awaiting-human-review",
    ]);
    const run = await repo.run(1);
    expect(run.pushes).toBe(3);
    expect(run.progress.reviewRound).toBe(2);
    expect(run.usage.map((entry) => entry.role)).toEqual([
      "planner",
      "developer",
      "developer",
      "reviewer",
      "developer",
      "reviewer",
    ]);
    expect(
      [...repo.github.checkRuns.values()].map((check) => check.conclusion),
    ).toEqual(["failure", "success"]);
    expect(repo.comments(1)).toEqual([
      expect.stringMatching(/^### Plan, wersja 1/),
    ]);
  });

  it("opens one draft pull request that closes the issue", async () => {
    const repo = new Harness();
    await repo.label(1, "agent:ready");
    await repo.gates(1, "failure");
    const pulls = [...repo.github.pulls.values()];
    expect(pulls).toHaveLength(1);
    expect(pulls[0]?.headRef).toBe("chore/1-stub-run");
    expect((await repo.run(1)).pr).toBe(pulls[0]?.number);
  });

  it("waits for approval of a high-impact plan and redoes it after a comment", async () => {
    const repo = new Harness();
    repo.setScenario(1, "plans: [high-impact, high-impact]");
    expect(await repo.label(1, "agent:ready")).toEqual(["planner"]);
    expect(await repo.state(1)).toBe("awaiting-plan-approval");
    expect(await repo.comment(1)).toEqual(["planner"]);
    expect((await repo.run(1)).progress.planVersion).toBe(2);
    expect(await repo.label(1, "plan:approved")).toEqual(["developer"]);
    const run = await repo.run(1);
    expect(run.approval).toMatchObject({ version: 2, by: "author" });
    expect(run.progress.state).toBe("gating");
  });

  it("goes back to awaiting-plan-approval when the Developer updates the plan", async () => {
    const repo = new Harness();
    repo.setScenario(1, "plan_update: high-impact");
    expect(await repo.label(1, "agent:ready")).toEqual([
      "planner",
      "developer",
    ]);
    expect(await repo.state(1)).toBe("awaiting-plan-approval");
    expect(await repo.label(1, "plan:approved")).toEqual(["developer"]);
    expect(await repo.state(1)).toBe("gating");
  });

  it("ignores plan:approved outside awaiting-plan-approval (FR-4.5)", async () => {
    const repo = new Harness();
    await repo.label(1, "agent:ready");
    expect(await repo.label(1, "plan:approved")).toEqual([]);
    expect((await repo.run(1)).approval).toBeUndefined();
  });

  it("starts no second run of an issue (FR-4.2)", async () => {
    const repo = new Harness();
    await repo.label(1, "agent:ready");
    await repo.unlabel(1, "agent:ready");
    expect(await repo.label(1, "agent:ready")).toEqual([]);
    expect((await repo.run(1)).id).toBe("1-1");
  });
});

describe("authors of events", () => {
  it("does not start a run for a label of a user without triage (FR-4.1)", async () => {
    const repo = new Harness();
    const reader = { login: "reader", type: "User" };
    repo.github.permissions.set("reader", "read");
    expect(await repo.label(1, "agent:ready", reader)).toEqual([]);
    expect(await repo.record(1)).toBeUndefined();
  });

  it("does not start a run for a label of a bot (SEC-8.7)", async () => {
    const repo = new Harness();
    const bot = { login: "sdlc-pipeline[bot]", type: "Bot" };
    repo.github.permissions.set(bot.login, "admin");
    expect(await repo.label(1, "agent:ready", bot)).toEqual([]);
    expect(await repo.record(1)).toBeUndefined();
  });

  it("ignores a comment of a collaborator without write permission (FR-4.23)", async () => {
    const repo = new Harness();
    repo.setScenario(1, "plans: [high-impact]");
    await repo.label(1, "agent:ready");
    const triager = { login: "triager", type: "User" };
    repo.github.permissions.set("triager", "triage");
    expect(await repo.comment(1, triager, "COLLABORATOR")).toEqual([]);
    expect(await repo.comment(1, AUTHOR_STRANGER, "NONE")).toEqual([]);
    expect(await repo.state(1)).toBe("awaiting-plan-approval");
  });

  it("ignores plan:approved of a user without triage", async () => {
    const repo = new Harness();
    repo.setScenario(1, "plans: [high-impact]");
    await repo.label(1, "agent:ready");
    repo.github.permissions.set("reader", "read");
    expect(
      await repo.label(1, "plan:approved", { login: "reader", type: "User" }),
    ).toEqual([]);
    expect(await repo.state(1)).toBe("awaiting-plan-approval");
  });
});

const AUTHOR_STRANGER = { login: "stranger", type: "User" };

describe("refusals of agent:ready", () => {
  it("removes agent:ready when the issue has agent:stop (FR-4.28b)", async () => {
    const repo = new Harness();
    repo.github.label(1, "agent:stop", "author");
    expect(await repo.label(1, "agent:ready")).toEqual([]);
    expect(await repo.record(1)).toBeUndefined();
    expect(repo.github.issues.get(1)?.labels).toEqual(["agent:stop"]);
    expect(repo.comments(1)).toEqual([
      expect.stringContaining("Zdejmij najpierw `agent:stop`"),
    ]);
  });

  it("removes agent:ready when the open pull request of the issue has agent:stop", async () => {
    const repo = new Harness();
    repo.github.addPull({
      number: 9,
      headRef: "feat/1-old-work",
      headRepo: REPO,
      labels: ["agent:stop"],
    });
    expect(await repo.label(1, "agent:ready")).toEqual([]);
    expect(repo.github.issues.get(1)?.labels).toEqual([]);
  });

  it("refuses an invalid .sdlc-agents.yml with its errors (FR-10.1)", async () => {
    const repo = new Harness(
      "version: 1\nlimits:\n  max_minutes_per_run: 600\n",
    );
    expect(await repo.label(1, "agent:ready")).toEqual([]);
    expect(repo.github.issues.get(1)?.labels).toEqual([]);
    expect(repo.comments(1)[0]).toMatch(
      /niepoprawny \(FR-10\.1\)[\s\S]*- commands/,
    );
  });

  it("refuses the ready label of an invalid configuration under its own name", async () => {
    const repo = new Harness("version: 2\nlabels:\n  ready: go\n");
    expect(await repo.label(1, "agent:ready")).toEqual([]);
    expect(repo.comments(1)).toEqual([]);
    expect(await repo.label(1, "go")).toEqual([]);
    expect(repo.comments(1)).toHaveLength(1);
  });
});
