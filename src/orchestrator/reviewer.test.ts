import { describe, expect, it } from "vitest";
import type { ReviewerBrief } from "../agents/reviewer/brief.ts";
import type { Review } from "../agents/reviewer/review.ts";
import type {
  RoleInput,
  RoleResult,
  RoleRunner,
} from "../agents/role-runner.ts";
import { StubRoleRunner } from "../agents/stub-role.ts";
import { parseReviewRecord } from "../agents/reviewer/review-comment.ts";
import { AGENT_REVIEW } from "./agent-review.ts";
import { Harness } from "./test-harness.ts";

const USAGE = { input_tokens: 1, output_tokens: 1, cost_usd: 0, turns: 1 };
const FILE =
  "export const a = 1;\nexport const b = 2;\nexport const c = a * 2;\n";
const PATCH =
  "@@ -1,1 +1,3 @@\n export const a = 1;\n+export const b = 2;\n+export const c = a * 2;";

// The stub roles, with a Reviewer that returns the given reviews, one per
// round; the last one repeats. It records what each Reviewer session got.
class ScriptedReviewer implements RoleRunner {
  readonly inputs: RoleInput[] = [];
  private readonly stub = new StubRoleRunner(() => Promise.resolve());
  private readonly reviews: Review[];

  constructor(...reviews: Review[]) {
    this.reviews = reviews;
  }

  run(input: RoleInput, signal: AbortSignal): Promise<unknown> {
    if (input.role !== "reviewer") return this.stub.run(input, signal);
    this.inputs.push(input);
    const review =
      this.reviews[Math.min(this.inputs.length - 1, this.reviews.length - 1)];
    const result: RoleResult = {
      status: "ok",
      output: { role: "reviewer", review: review ?? CLEAN },
      usage: USAGE,
    };
    return Promise.resolve(result);
  }

  brief(round: number): ReviewerBrief | undefined {
    const brief = this.inputs[round]?.brief;
    return brief?.kind === "reviewer" ? brief : undefined;
  }
}

const CLEAN: Review = { findings: [], earlier: [] };

function finding(fields: Partial<Review["findings"][number]> = {}) {
  return {
    path: "src/price.ts",
    line: 3,
    rule: "kiss" as const,
    blocking: true,
    description: "Zbyt złożone mnożenie.",
    suggestion: "Uprość.",
    ...fields,
  };
}

// A run up to its first review: the stub Planner and Developer, and a pull
// request whose diff and files the in-memory GitHub knows.
async function reviewed(...reviews: Review[]) {
  const repo = new Harness();
  const reviewer = new ScriptedReviewer(...reviews);
  repo.runner = reviewer;
  await repo.label(1, "agent:ready");
  const sha = await repo.pushedFile(1, "src/price.ts", FILE, PATCH);
  const jobs = [{ id: 1, name: "test", conclusion: "success", log: "" }];
  const roles = await repo.gates(1, "success", jobs);
  return { repo, reviewer, roles, sha };
}

function firstReview(repo: Harness) {
  const [review] = repo.github.reviews.reviews;
  if (review === undefined) throw new Error("No review was posted.");
  return review;
}

describe("a Reviewer stage", () => {
  it("reviews the whole diff of the pushed commit with the context of FR-5.3", async () => {
    const { repo, reviewer, roles, sha } = await reviewed(CLEAN);
    expect(roles).toEqual(["reviewer"]);
    const run = await repo.run(1);
    expect(repo.workspace.prepared.at(-1)).toEqual({
      branch: run.branch,
      at: sha,
    });
    const brief = reviewer.brief(0);
    expect(brief).toMatchObject({
      sha,
      plan: { version: 1 },
      diff: [{ path: "src/price.ts", patch: PATCH }],
      gates: { jobs: [{ name: "test", conclusion: "success" }] },
      earlier: [],
    });
    // Nothing of the Developer's session: not even its summary.
    expect(JSON.stringify(brief)).not.toContain("Zaślepka Developera");
  });

  it("approves with a review that only comments and a successful check (FR-6.2)", async () => {
    const { repo, sha } = await reviewed(CLEAN);
    const [review] = repo.github.reviews.reviews;
    expect(review?.body).toContain("`approve`");
    expect(parseReviewRecord(review?.body ?? "")).toMatchObject({
      verdict: "approve",
      round: 1,
      sha,
    });
    const checks = [...repo.github.checkRuns.values()];
    expect(checks).toMatchObject([
      {
        name: AGENT_REVIEW,
        headSha: sha,
        conclusion: "success",
        output: { title: "approve", detailsUrl: review?.url },
      },
    ]);
    expect(await repo.state(1)).toBe("awaiting-human-review");
  });

  it("requests changes for a blocking finding, with its stable identifier", async () => {
    const { repo } = await reviewed(
      { findings: [finding(), finding({ line: 3 })], earlier: [] },
      CLEAN,
    );
    const review = firstReview(repo);
    const record = parseReviewRecord(review.body);
    expect(record?.verdict).toBe("changes_requested");
    expect(record?.findings).toHaveLength(1);
    const id = (await repo.run(1)).progress.findings[0] ?? "";
    expect(id).toMatch(/^F-[0-9a-f]{12}$/);
    expect(review.comments).toMatchObject([{ path: "src/price.ts", line: 3 }]);
    expect(review.comments.map((comment) => comment.body).join()).toContain(
      `<!-- sdlc-finding ${id} -->`,
    );
    const checks = [...repo.github.checkRuns.values()];
    expect(checks[0]).toMatchObject({ conclusion: "failure" });
    const run = await repo.run(1);
    expect(run.progress).toMatchObject({ state: "gating", findings: [id] });
  });

  it("passes a non-blocking finding with an approve (FR-4.17)", async () => {
    const minor = finding({ blocking: false, nonBlockingReason: "Drobne." });
    const { repo } = await reviewed({ findings: [minor], earlier: [] });
    expect(await repo.state(1)).toBe("awaiting-human-review");
  });

  it("escalates an earlier finding that the next round finds unresolved", async () => {
    const { repo, reviewer } = await reviewed(
      { findings: [finding()], earlier: [] },
      { findings: [], earlier: [] },
    );
    await repo.gates(1, "success");
    const brief = reviewer.brief(1);
    expect(brief?.earlier.map((entry) => entry.finding.rule)).toEqual(["kiss"]);
    // The session left the earlier finding out, so it stays open.
    expect(await repo.state(1)).toBe("needs-human");
    const record = parseReviewRecord(
      repo.github.reviews.reviews.at(-1)?.body ?? "",
    );
    expect(record?.earlier).toMatchObject([{ resolved: false }]);
    expect(repo.comments(1).at(-1)).toMatch(/drugi raz/);
  });

  it("approves when the next round finds the earlier finding resolved", async () => {
    const { repo } = await reviewed({ findings: [finding()], earlier: [] });
    const id = (await repo.run(1)).progress.findings[0] ?? "";
    const resolved: Review = {
      findings: [],
      earlier: [{ id, resolved: true, note: "Poprawione." }],
    };
    repo.runner = new ScriptedReviewer(resolved);
    await repo.gates(1, "success");
    expect(await repo.state(1)).toBe("awaiting-human-review");
  });
});
