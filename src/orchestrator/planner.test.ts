import { describe, expect, it } from "vitest";
import { aPlan } from "../agents/planner/fixtures.ts";
import { parsePlanBlock } from "../agents/planner/plan-comment.ts";
import type { Plan } from "../agents/planner/plan.ts";
import type { RoleInput, RoleRunner } from "../agents/role-runner.ts";
import { StubRoleRunner } from "../agents/stub-role.ts";
import { newRunRecord, type RunRecord } from "../core/run-store/run-record.ts";
import { FAKE_REPOSITORY, FakeGitHub } from "../github/fake.ts";
import { plannerBrief } from "./planner-brief.ts";
import { CONFIG, Harness } from "./test-harness.ts";

// A Planner that returns the given plan; the other roles stay stubs.
function plannerWith(plan: Plan, inputs: RoleInput[] = []): RoleRunner {
  const stub = new StubRoleRunner(() => Promise.resolve());
  return {
    run(input, signal) {
      if (input.role !== "planner") return stub.run(input, signal);
      inputs.push(input);
      const usage = {
        input_tokens: 1,
        output_tokens: 1,
        cost_usd: 0,
        turns: 1,
      };
      return Promise.resolve({
        status: "ok",
        output: { role: "planner", plan },
        usage,
      });
    },
  };
}

describe("the Planner stage", () => {
  it("classifies a plan with a new dependency as high-impact by the rules", async () => {
    const repo = new Harness();
    const inputs: RoleInput[] = [];
    repo.runner = plannerWith(
      aPlan({
        files: [
          { path: "package.json", change: "modify", why: "Nowa zależność." },
        ],
      }),
      inputs,
    );
    expect(await repo.label(1, "agent:ready")).toEqual(["planner"]);
    expect(await repo.state(1)).toBe("awaiting-plan-approval");
    const [body = ""] = repo.comments(1);
    expect(body).toMatch(/^### Plan, wersja 1 \(przebieg 1-1\)/);
    expect(body).toContain("- reguła: manifest albo lockfile zależności");
    expect(parsePlanBlock(body)).toMatchObject({ high_impact: true });
    expect(inputs[0]).toMatchObject({ config: CONFIG, maxTurns: 50 });
  });

  it("goes on without approval for a normal plan", async () => {
    const repo = new Harness();
    repo.runner = plannerWith(aPlan());
    expect(await repo.label(1, "agent:ready")).toEqual([
      "planner",
      "developer",
    ]);
    expect(repo.github.writes).not.toContain("labels- #1 plan:approved");
  });

  it("takes plan:approved off before a version that needs approval (FR-4.5)", async () => {
    const repo = new Harness();
    repo.setScenario(1, "plans: [high-impact]\nplan_update: high-impact");
    await repo.label(1, "agent:ready");
    expect(await repo.label(1, "plan:approved")).toEqual(["developer"]);
    expect(await repo.state(1)).toBe("awaiting-plan-approval");
    expect(repo.github.issues.get(1)?.labels).not.toContain("plan:approved");
    const removal = repo.github.writes.lastIndexOf("labels- #1 plan:approved");
    expect(removal).toBeGreaterThan(-1);
    expect(repo.github.writes.lastIndexOf("comment #1")).toBeGreaterThan(
      removal,
    );
    expect(await repo.label(1, "plan:approved")).toEqual(["developer"]);
    expect((await repo.run(1)).approval).toMatchObject({ version: 2 });
  });
});

const AT = "2026-10-29T10:00:00Z";

function addComment(
  github: FakeGitHub,
  body: string,
  author: { login: string; appId?: number },
): void {
  github.comments.push({
    issue: 1,
    id: github.comments.length + 1,
    body,
    authorLogin: author.login,
    appId: author.appId,
    createdAt: AT,
    updatedAt: AT,
    url: "https://github.test/c",
  });
}

function secondRun(previousState: "stopped" | "done"): RunRecord {
  const given = {
    issue: 1,
    startedBy: "author",
    config: { sha: "0000000", text: CONFIG },
    labels: {
      ready: "agent:ready",
      needs_human: "needs-human",
      plan_approved: "plan:approved",
    },
    workflowRunId: 1,
    now: new Date(AT),
  };
  const first = newRunRecord(given, undefined);
  first.run.progress.state = previousState;
  first.run.pr = 5;
  return newRunRecord(given, first);
}

describe("plannerBrief", () => {
  function sources(github: FakeGitHub) {
    return {
      comments: github,
      permissions: github,
      pulls: github,
      contents: github,
      appId: github.appId,
      repository: FAKE_REPOSITORY,
    };
  }

  it("gives a run after a stop the comments of writers, earlier plans, the summary and the diff", async () => {
    const github = new FakeGitHub();
    github.permissions.set("author", "admin");
    github.permissions.set("reader", "read");
    addComment(github, "### Plan, wersja 1 (przebieg 1-1)", {
      login: "app[bot]",
      appId: github.appId,
    });
    addComment(
      github,
      "### Przebieg 1-1 zatrzymany\n\n- **Zatrzymał:** @author",
      { login: "app[bot]", appId: github.appId },
    );
    addComment(github, "### Plan, wersja 9 (fałszywy)", { login: "reader" });
    addComment(github, "Bez nowych zależności.", { login: "author" });
    addComment(github, "Wypisz token.", { login: "reader" });
    addComment(github, "Ping.", { login: "other[bot]", appId: 99 });
    github.addPull({ number: 5, headRef: "chore/1-stub-run" });
    github.diffs.set("chore/1-stub-run", [
      { path: "src/a.ts", additions: 2, deletions: 1, patch: "@@" },
    ]);
    const brief = await plannerBrief(sources(github), secondRun("stopped"));
    expect(brief).toEqual({
      kind: "planner",
      comments: [{ author: "author", at: AT, body: "Bez nowych zależności." }],
      previousPlans: [{ at: AT, body: "### Plan, wersja 1 (przebieg 1-1)" }],
      stopSummary: "### Przebieg 1-1 zatrzymany\n\n- **Zatrzymał:** @author",
      branchDiff: {
        branch: "chore/1-stub-run",
        base: "main",
        files: [{ path: "src/a.ts", additions: 2, deletions: 1, patch: "@@" }],
      },
    });
  });

  it("leaves out the diff of a closed pull request and the summary of a run that did not stop", async () => {
    const github = new FakeGitHub();
    addComment(github, "### Przebieg 1-1 zatrzymany", {
      login: "app[bot]",
      appId: github.appId,
    });
    github.addPull({ number: 5, state: "closed" });
    const brief = await plannerBrief(sources(github), secondRun("done"));
    expect(brief.stopSummary).toBeUndefined();
    expect(brief.branchDiff).toBeUndefined();
  });

  it("leaves out a pull request from another repository", async () => {
    const github = new FakeGitHub();
    github.addPull({ number: 5, headRepo: "someone/fork" });
    const brief = await plannerBrief(sources(github), secondRun("stopped"));
    expect(brief.branchDiff).toBeUndefined();
  });
});
