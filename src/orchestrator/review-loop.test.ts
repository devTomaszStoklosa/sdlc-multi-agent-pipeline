import { describe, expect, it } from "vitest";
import type { DeveloperBrief } from "../agents/developer/brief.ts";
import { aWork } from "../agents/developer/fixtures.ts";
import type { DeveloperWork } from "../agents/developer/work.ts";
import type { ReviewerBrief } from "../agents/reviewer/brief.ts";
import type { Review } from "../agents/reviewer/review.ts";
import type {
  RoleInput,
  RoleOutput,
  RoleRunner,
} from "../agents/role-runner.ts";
import { StubRoleRunner } from "../agents/stub-role.ts";
import { Harness } from "./test-harness.ts";

const USAGE = { input_tokens: 1, output_tokens: 1, cost_usd: 0, turns: 1 };
const FILE = "export const a = 1;\nexport const c = a * 2;\n";
const PATCH = "@@ -1,1 +1,2 @@\n export const a = 1;\n+export const c = a * 2;";

const FINDING: Review = {
  findings: [
    {
      path: "src/price.ts",
      line: 2,
      rule: "kiss",
      blocking: true,
      description: "Mnożenie powinno być stałą.",
      suggestion: "Wydziel stałą.",
    },
  ],
  earlier: [],
};

type Answer<T> = (input: RoleInput) => T;

// The stub Planner, a Developer and a Reviewer that answer by stage, the last
// answer repeating, and record their briefs.
class ScriptedLoop implements RoleRunner {
  readonly developers: DeveloperBrief[] = [];
  readonly reviewers: ReviewerBrief[] = [];
  private readonly stub = new StubRoleRunner(() => Promise.resolve());
  private readonly works: Answer<DeveloperWork>[];
  private readonly reviews: Answer<Review>[];

  constructor(works: Answer<DeveloperWork>[], reviews: Answer<Review>[]) {
    this.works = works;
    this.reviews = reviews;
  }

  run(input: RoleInput, signal: AbortSignal): Promise<unknown> {
    const { brief } = input;
    let output: RoleOutput;
    if (brief?.kind === "developer") {
      this.developers.push(brief);
      const work = pick(this.works, this.developers.length)(input);
      output = { role: "developer", work };
    } else if (brief?.kind === "reviewer") {
      this.reviewers.push(brief);
      const review = pick(this.reviews, this.reviewers.length)(input);
      output = { role: "reviewer", review };
    } else {
      return this.stub.run(input, signal);
    }
    return Promise.resolve({ status: "ok", output, usage: USAGE });
  }
}

function pick<T>(answers: readonly T[], count: number): T {
  const answer = answers[Math.min(count, answers.length) - 1];
  if (answer === undefined) throw new Error("No scripted answer.");
  return answer;
}

// Replies to every open finding instead of changing the code.
const disputes: Answer<DeveloperWork> = (input) => {
  const brief = input.brief?.kind === "developer" ? input.brief : undefined;
  return aWork({
    commit: { type: "chore", subject: "answer review findings" },
    replies: (brief?.review?.findings ?? []).map(({ finding }) => ({
      finding: finding.id,
      reply: "Stała nic nie upraszcza.",
    })),
  });
};

async function firstReview(loop: ScriptedLoop) {
  const repo = new Harness();
  repo.runner = loop;
  await repo.label(1, "agent:ready");
  const sha = await repo.pushedFile(1, "src/price.ts", FILE, PATCH);
  return { repo, sha };
}

describe("the review loop", () => {
  it("gives the Developer the open findings of the review (FR-4.15)", async () => {
    const loop = new ScriptedLoop(
      [() => aWork()],
      [() => FINDING, () => ({ findings: [], earlier: [] })],
    );
    const { repo, sha } = await firstReview(loop);
    expect(await repo.gates(1, "success")).toEqual(["reviewer", "developer"]);
    const review = loop.developers[1]?.review;
    expect(review?.sha).toBe(sha);
    expect(review?.findings).toMatchObject([
      { finding: { rule: "kiss", line: 2 }, replies: [] },
    ]);
  });

  it("pushes an empty commit for replies alone and the next round sees them", async () => {
    const loop = new ScriptedLoop(
      [() => aWork(), disputes],
      [
        () => FINDING,
        (input) => {
          const brief =
            input.brief?.kind === "reviewer" ? input.brief : undefined;
          const id = brief?.earlier[0]?.finding.id ?? "";
          return {
            findings: [],
            earlier: [{ id, resolved: true, note: "Odpowiedź przekonuje." }],
          };
        },
      ],
    );
    const { repo } = await firstReview(loop);
    repo.workspace.changed = false;
    await repo.gates(1, "success");
    expect(repo.workspace.commits.at(-1)).toBe(
      "chore: answer review findings (#1)",
    );
    const replies = repo.github.reviews.comments.filter(
      (comment) => comment.inReplyTo !== undefined,
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.body).toContain("Stała nic nie upraszcza.");
    expect(await repo.state(1)).toBe("gating");
    await repo.gates(1, "success");
    expect(loop.reviewers[1]?.earlier[0]?.replies).toEqual([
      expect.stringContaining("Stała nic nie upraszcza.") as string,
    ]);
    expect(await repo.state(1)).toBe("awaiting-human-review");
  });

  it("escalates when the next round keeps the disputed finding", async () => {
    const loop = new ScriptedLoop([() => aWork(), disputes], [() => FINDING]);
    const { repo } = await firstReview(loop);
    repo.workspace.changed = false;
    await repo.gates(1, "success");
    await repo.gates(1, "success");
    expect(await repo.state(1)).toBe("needs-human");
  });

  it("does not answer a review of an earlier commit with an empty commit", async () => {
    const loop = new ScriptedLoop(
      [() => aWork(), () => aWork(), disputes],
      [() => FINDING],
    );
    const { repo } = await firstReview(loop);
    await repo.gates(1, "success");
    // The fix failed the gates; replies alone do not get past them.
    repo.workspace.changed = false;
    await repo.gates(1, "failure");
    expect(repo.github.reviews.comments.some((c) => c.inReplyTo)).toBe(false);
    expect(await repo.state(1)).toBe("needs-human");
  });
});
