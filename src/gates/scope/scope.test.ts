import { describe, expect, it } from "vitest";
import { aPlan } from "../../agents/planner/fixtures.ts";
import { planComment } from "../../agents/planner/plan-comment.ts";
import { FAKE_REPOSITORY, FakeGitHub } from "../../github/fake.ts";
import type { ChangedFile } from "../../github/ports.ts";
import { scopeFindings } from "./check.ts";
import { passed, report, runScopeGate } from "./gate.ts";

const PLAN = [
  { path: "src/price.ts", change: "modify", why: "x" },
  { path: "package.json", change: "modify", why: "x" },
] as const;

function changed(...paths: string[]): ChangedFile[] {
  return paths.map((file) => ({ path: file, additions: 1, deletions: 0 }));
}

describe("scopeFindings", () => {
  it("passes the files of the plan", () => {
    expect(
      scopeFindings(changed("src/price.ts", "package.json"), PLAN),
    ).toEqual([]);
  });

  it("reports every file outside the plan (QG-7.9)", () => {
    expect(scopeFindings(changed("src/price.ts", "src/cart.ts"), PLAN)).toEqual(
      [{ path: "src/cart.ts", reason: "plik spoza planu" }],
    );
  });

  it("allows a lockfile only next to a planned manifest", () => {
    expect(
      scopeFindings(
        changed("package-lock.json", "web/package-lock.json"),
        PLAN,
      ),
    ).toEqual([
      {
        path: "web/package-lock.json",
        reason: "lockfile bez zmiany manifestu zależności w planie",
      },
    ]);
    const plan = [
      { path: "src/price.ts", change: "modify", why: "x" },
    ] as const;
    expect(scopeFindings(changed("package-lock.json"), plan)).toHaveLength(1);
  });

  it("needs both paths of a renamed file in the plan", () => {
    const renamed = [
      {
        path: "src/price.ts",
        previousPath: "src/old.ts",
        additions: 0,
        deletions: 0,
      },
    ];
    expect(scopeFindings(renamed, PLAN)).toEqual([
      { path: "src/old.ts", reason: "plik spoza planu" },
    ]);
  });
});

const BOT = { login: "sdlc-app[bot]", type: "Bot" };

function pullEvent(
  fields: { user?: object; ref?: string; repo?: string | null } = {},
) {
  const repo = fields.repo === undefined ? FAKE_REPOSITORY : fields.repo;
  return {
    name: "pull_request",
    payload: {
      pull_request: {
        user: fields.user ?? BOT,
        head: {
          ref: fields.ref ?? "feat/12-rabat",
          sha: "abc1234",
          repo: repo === null ? null : { full_name: repo },
        },
        base: { ref: "main" },
      },
    },
  };
}

function demo(): FakeGitHub {
  const github = new FakeGitHub();
  github.addIssue(12);
  github.commentAppId = github.appId;
  return github;
}

async function gate(
  github: FakeGitHub,
  event: { name: string; payload: unknown } = pullEvent(),
) {
  return runScopeGate(
    {
      comments: github,
      contents: github,
      appId: github.appId,
      repository: FAKE_REPOSITORY,
    },
    event,
  );
}

async function postPlan(
  github: FakeGitHub,
  runId: string,
  version: number,
  paths: string[],
) {
  await github.createComment(
    12,
    planComment({
      runId,
      version,
      plan: aPlan({
        files: paths.map((file) => ({
          path: file,
          change: "modify",
          why: "x",
        })),
      }),
      classification: { highImpact: false, reasons: [] },
      approvalLabel: "plan:approved",
    }),
  );
}

describe("runScopeGate", () => {
  it("checks a run's pull request against the newest plan", async () => {
    const github = demo();
    await postPlan(github, "12-1", 1, ["src/price.ts", "src/cart.ts"]);
    await postPlan(github, "12-1", 2, ["src/price.ts"]);
    github.diffs.set("abc1234", changed("src/price.ts", "src/cart.ts"));
    const result = await gate(github);
    expect(passed(result)).toBe(false);
    expect(report(result)).toContain("planu 2 przebiegu 12-1 issue #12");
    expect(report(result)).toContain("- `src/cart.ts`: plik spoza planu");
  });

  it("passes a run's pull request within its plan", async () => {
    const github = demo();
    await postPlan(github, "12-1", 1, ["src/price.ts"]);
    github.diffs.set("abc1234", changed("src/price.ts"));
    const result = await gate(github);
    expect(passed(result)).toBe(true);
    expect(report(result)).toMatch(/^Bramka zakresu zaliczona/);
  });

  it("fails a run's pull request without a plan of the pipeline", async () => {
    const github = demo();
    github.commentAppId = 99;
    await postPlan(github, "12-1", 1, ["src/price.ts"]);
    const result = await gate(github);
    expect(passed(result)).toBe(false);
    expect(report(result)).toContain("nie ma planu pipeline'u");
  });

  it.each([
    [
      "a person's pull request",
      pullEvent({ user: { login: "author", type: "User" } }),
    ],
    ["a pull request from a fork", pullEvent({ repo: "someone/fork" })],
    ["a pull request from a deleted fork", pullEvent({ repo: null })],
    [
      "a bot's pull request off a run branch",
      pullEvent({ ref: "dependabot/npm/x" }),
    ],
    ["a push", { name: "push", payload: {} }],
  ])("does not apply to %s", async (_name, event) => {
    const result = await gate(demo(), event);
    expect(result.applies).toBe(false);
    expect(passed(result)).toBe(true);
  });
});
