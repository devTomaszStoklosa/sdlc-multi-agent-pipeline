import { describe, expect, it } from "vitest";
import { CONFIG, Harness } from "./test-harness.ts";

describe("retries and escalation", () => {
  it("retries a stage after infrastructure errors (FR-4.30)", async () => {
    const repo = new Harness();
    repo.setScenario(1, "failures:\n  planner: [infra, infra]");
    expect(await repo.label(1, "agent:ready")).toEqual([
      "planner",
      "developer",
    ]);
    expect((await repo.run(1)).usage[0]?.attempts).toBe(3);
    expect(await repo.state(1)).toBe("gating");
    const attempts = repo.log.records.filter(
      (record) => record.type === "stage-attempt" && record.agent === "planner",
    );
    expect(attempts.map((record) => record.details)).toEqual([
      { attempt: 1, message: "Stub planner failure infra on attempt 1." },
      { attempt: 2, message: "Stub planner failure infra on attempt 2." },
      { attempt: 3 },
    ]);
  });

  it("escalates after the retry budget and resumes when needs-human goes", async () => {
    const repo = new Harness();
    repo.setScenario(1, "failures:\n  planner: [infra, infra, infra]");
    expect(await repo.label(1, "agent:ready")).toEqual(["planner"]);
    expect(await repo.state(1)).toBe("needs-human");
    expect(repo.github.issues.get(1)?.labels).toContain("needs-human");
    expect(repo.comments(1)).toEqual([
      expect.stringMatching(/infrastrukturalnych[\s\S]*od stanu `planning`/),
    ]);
    repo.setScenario(1, "plans: [normal]");
    expect(await repo.unlabel(1, "needs-human")).toEqual([
      "planner",
      "developer",
    ]);
    expect(await repo.state(1)).toBe("gating");
  });

  it("escalates on the Pro plan's limit with the time it renews", async () => {
    const repo = new Harness();
    repo.setScenario(
      1,
      "failures:\n  planner: [usage-limit, usage-limit, usage-limit]",
    );
    await repo.label(1, "agent:ready");
    expect(await repo.state(1)).toBe("needs-human");
    expect(repo.comments(1)[0]).toMatch(
      /limit planu Claude Pro, który odnowi się \d{4}-/,
    );
  });

  it("escalates when a session reaches its turn limit", async () => {
    const repo = new Harness();
    repo.setScenario(1, "failures:\n  developer: [max-turns]");
    await repo.label(1, "agent:ready");
    expect(await repo.state(1)).toBe("needs-human");
    expect(repo.comments(1).at(-1)).toMatch(/limit tur/);
  });

  it("escalates a repeated blocking finding (FR-4.18)", async () => {
    const repo = new Harness();
    repo.setScenario(1, "verdicts: [changes_requested]\nrepeat_finding: true");
    await repo.label(1, "agent:ready");
    await repo.gates(1, "success");
    expect(await repo.state(1)).toBe("gating");
    expect(await repo.gates(1, "success")).toEqual(["reviewer"]);
    expect(await repo.state(1)).toBe("needs-human");
    expect(repo.comments(1).at(-1)).toMatch(/drugi raz: stub-finding/);
  });

  it("escalates after the configured number of review rounds", async () => {
    const repo = new Harness(`${CONFIG}review:\n  max_rounds: 1\n`);
    repo.setScenario(1, "verdicts: [changes_requested]");
    await repo.label(1, "agent:ready");
    expect(await repo.gates(1, "success")).toEqual(["reviewer"]);
    expect(await repo.state(1)).toBe("needs-human");
    expect(repo.comments(1).at(-1)).toMatch(/limit rund review \(1\)/);
  });

  it("stops at the cost limit before the next role (FR-4.31)", async () => {
    const repo = new Harness();
    repo.setScenario(1, "cost_usd: 6");
    expect(await repo.label(1, "agent:ready")).toEqual([
      "planner",
      "developer",
    ]);
    await repo.gates(1, "success");
    expect(await repo.state(1)).toBe("needs-human");
    expect(repo.comments(1).at(-1)).toMatch(/limit kosztu/);
  });

  it("counts only working time towards the time limit (NFR-11.5)", async () => {
    const repo = new Harness();
    repo.setScenario(1, "plans: [high-impact]");
    await repo.label(1, "agent:ready");
    repo.tick(600);
    expect(await repo.label(1, "plan:approved")).toEqual(["developer"]);
    repo.tick(50);
    expect(await repo.gates(1, "success")).toEqual([]);
    expect(await repo.state(1)).toBe("needs-human");
    expect(repo.comments(1).at(-1)).toMatch(/limit czasu/);
  });
});

describe("the configuration copy (FR-10.5)", () => {
  it("keeps the labels and limits of the start while main changes", async () => {
    const repo = new Harness();
    repo.setScenario(
      1,
      "plans: [high-impact]\nfailures:\n  developer: [infra, infra]",
    );
    await repo.label(1, "agent:ready");
    repo.commitToMain(
      `${CONFIG}labels:\n  plan_approved: approved\nlimits:\n  stage_retries: 0\n`,
    );
    expect(await repo.label(1, "approved")).toEqual([]);
    expect(await repo.label(1, "plan:approved")).toEqual(["developer"]);
    expect(await repo.state(1)).toBe("gating");
  });
});

describe("one run at a time (plan 1.2)", () => {
  it("queues a second issue and starts it from a manual dispatch", async () => {
    const repo = new Harness();
    repo.github.addIssue(2);
    await repo.label(1, "agent:ready");
    repo.tick(1);
    expect(await repo.label(2, "agent:ready")).toEqual([]);
    expect(await repo.state(2)).toBe("queued");
    expect(repo.comments(2)).toEqual([
      expect.stringContaining("trwa przebieg issue #1"),
    ]);
    expect(await repo.dispatch(2)).toEqual([]);
    repo.github.issues.get(1)?.labels.splice(0);
    expect(await repo.dispatch(2)).toEqual(["planner", "developer"]);
  });
});

describe("a manual dispatch (FR-4.36 in the MVP)", () => {
  it("recovers gate results that did not arrive", async () => {
    const repo = new Harness();
    await repo.label(1, "agent:ready");
    const run = await repo.run(1);
    repo.github.addRun(900, {
      name: "Gates",
      headSha: run.progress.pushedSha,
      status: "completed",
      conclusion: "success",
    });
    expect(await repo.dispatch(1)).toEqual(["reviewer"]);
  });

  it("escalates a stage whose job ended without a result", async () => {
    const repo = new Harness();
    await repo.label(1, "agent:ready");
    const record = await repo.record(1);
    if (!record) throw new Error("no run");
    const stuck = {
      ...record.run,
      progress: { ...record.run.progress, state: "developing" as const },
    };
    await repo.store.write(
      {
        ...record,
        run: { ...stuck, workflowRun: { id: 100, role: "developer" } },
      },
      record.revision,
    );
    expect(await repo.dispatch(1)).toEqual([]);
    expect(await repo.state(1)).toBe("needs-human");
  });

  it("does nothing for a user without write permission", async () => {
    const repo = new Harness();
    repo.github.permissions.set("triager", "triage");
    await repo.label(1, "agent:ready");
    expect(await repo.dispatch(1, { login: "triager", type: "User" })).toEqual(
      [],
    );
    expect(await repo.state(1)).toBe("gating");
  });
});

describe("the check before side effects (FR-4.28c)", () => {
  it("skips the role when agent:stop arrives before its job", async () => {
    const repo = new Harness();
    repo.setScenario(1, "plans: [high-impact]");
    await repo.label(1, "agent:ready");
    repo.github.label(1, "agent:stop", "author");
    const writes = repo.github.writes.length;
    expect(await repo.label(1, "plan:approved")).toEqual([]);
    expect(
      repo.github.writes.slice(writes).filter((w) => !w.startsWith("labels+")),
    ).toEqual([]);
    expect(repo.log.records.at(-1)).toMatchObject({ type: "ignored" });
  });
});
