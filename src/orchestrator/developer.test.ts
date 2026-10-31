import { describe, expect, it } from "vitest";
import type { DeveloperBrief } from "../agents/developer/brief.ts";
import { aWork } from "../agents/developer/fixtures.ts";
import type { DeveloperWork } from "../agents/developer/work.ts";
import type {
  RoleInput,
  RoleResult,
  RoleRunner,
} from "../agents/role-runner.ts";
import { StubRoleRunner } from "../agents/stub-role.ts";
import { Harness } from "./test-harness.ts";

const USAGE = { input_tokens: 1, output_tokens: 1, cost_usd: 0, turns: 1 };

// The stub roles, with a Developer that returns the given work, one entry per
// stage; the last one repeats. It records what each Developer session got.
class ScriptedDeveloper implements RoleRunner {
  readonly inputs: RoleInput[] = [];
  private readonly stub = new StubRoleRunner(() => Promise.resolve());
  private readonly works: DeveloperWork[];

  constructor(...works: DeveloperWork[]) {
    this.works = works;
  }

  run(input: RoleInput, signal: AbortSignal): Promise<unknown> {
    if (input.role !== "developer") return this.stub.run(input, signal);
    this.inputs.push(input);
    const work =
      this.works[Math.min(this.inputs.length - 1, this.works.length - 1)];
    const result: RoleResult = {
      status: "ok",
      output: { role: "developer", work: work ?? aWork() },
      usage: USAGE,
    };
    return Promise.resolve(result);
  }

  brief(stage: number): DeveloperBrief | undefined {
    const brief = this.inputs[stage]?.brief;
    return brief?.kind === "developer" ? brief : undefined;
  }
}

function harness(...works: DeveloperWork[]) {
  const repo = new Harness();
  const developer = new ScriptedDeveloper(...works);
  repo.runner = developer;
  return { repo, developer };
}

describe("a Developer stage", () => {
  it("commits, pushes and opens the draft pull request (FR-4.7 to FR-4.9)", async () => {
    const { repo, developer } = harness(
      aWork({
        commit: { type: "feat", scope: "cart", subject: "Add a discount." },
      }),
    );
    expect(await repo.label(1, "agent:ready")).toEqual([
      "planner",
      "developer",
    ]);
    expect(repo.workspace.prepared).toEqual([
      { branch: undefined, merge: undefined },
    ]);
    expect(repo.workspace.commits).toEqual(["feat(cart): add a discount (#1)"]);
    expect(repo.workspace.pushes.map((push) => push.branch)).toEqual([
      "feat/1-add-a-discount",
    ]);
    const [draft] = repo.github.drafts;
    expect(draft?.title).toBe("feat(cart): add a discount (#1)");
    expect(draft?.body).toMatch(/^Closes #1\n\nDodaje rabat/);
    expect(draft?.body).toContain(
      "- **Plan:** [wersja 1](https://github.test/",
    );
    const run = await repo.run(1);
    expect(run).toMatchObject({ branch: "feat/1-add-a-discount", pushes: 1 });
    expect(run.progress).toMatchObject({ state: "gating", planVersion: 1 });
    expect(developer.brief(0)).toMatchObject({
      plan: { version: 1 },
      gateFailures: [],
      conflicts: [],
      commands: { install: "npm ci", lint: "npm run lint", test: "npm test" },
    });
  });

  it("sends the logs of failed gates back without a review round (FR-4.12)", async () => {
    const { repo, developer } = harness();
    await repo.label(1, "agent:ready");
    const jobs = [
      {
        id: 1,
        name: "lint",
        conclusion: "failure",
        log: "2026-10-30T10:00:00.1234567Z error: no-unused-vars",
      },
      { id: 2, name: "test", conclusion: "success", log: "ok" },
    ];
    expect(await repo.gates(1, "failure", jobs)).toEqual(["developer"]);
    expect(developer.brief(1)?.gateFailures).toEqual([
      { job: "lint", log: "error: no-unused-vars" },
    ]);
    const run = await repo.run(1);
    expect(run.progress.reviewRound).toBe(0);
    expect(run.pushes).toBe(2);
    expect(repo.workspace.prepared[1]).toEqual({
      branch: "feat/1-add-a-discount",
      merge: undefined,
    });
  });

  it("opens the issues out of scope and lists them in the pull request (FR-4.10)", async () => {
    const { repo } = harness(
      aWork({
        outOfScope: [
          { title: "Błąd @owner w cenie", body: "Zła cena w <!-- x -->." },
        ],
      }),
      aWork({ outOfScope: [{ title: "Drugi", body: "Opis." }] }),
    );
    await repo.label(1, "agent:ready");
    const opened = [...repo.github.issues.values()].filter(
      (i) => i.number !== 1,
    );
    expect(opened).toHaveLength(1);
    expect(opened[0]?.title).toBe("Błąd @​owner w cenie");
    expect(opened[0]?.body).toContain("Zła cena w &lt;!-- x -->.");
    expect(opened[0]?.body).toContain("w przebiegu 1-1 issue #1 (FR-4.10)");
    const pr = (await repo.run(1)).pr ?? 0;
    expect(repo.github.pulls.get(pr)?.body).toContain(
      `- **Issue spoza zakresu:** #${String(opened[0]?.number)}`,
    );
    await repo.gates(1, "failure");
    expect(repo.github.pulls.get(pr)?.body).toMatch(
      /Issue spoza zakresu z kolejnego etapu:\*\* #\d+$/,
    );
  });

  it("publishes a plan update that needs no approval with the push (FR-4.11)", async () => {
    const { repo } = harness(
      aWork({
        planUpdate: {
          reason: "Zmiana sygnatury wymaga poprawy wywołania.",
          files: [{ path: "src/cart.ts", change: "modify", why: "Wywołanie." }],
          highImpact: { value: false, reasons: ["Jeden plik więcej."] },
        },
      }),
    );
    await repo.label(1, "agent:ready");
    const update = repo
      .comments(1)
      .find((body) => body.startsWith("### Aktualizacja planu"));
    expect(update).toMatch(
      /^### Aktualizacja planu, wersja 2 \(przebieg 1-1\)/,
    );
    expect(update).toContain("**Klasyfikacja:** zwykła zmiana.");
    expect(update).toContain("- ocena Developera: Jeden plik więcej.");
    expect(update).toContain("path: stub-runs/issue-1.json");
    expect(update).toContain("path: src/cart.ts");
    const run = await repo.run(1);
    expect(run.progress).toMatchObject({ state: "gating", planVersion: 2 });
    expect(repo.workspace.pushes).toHaveLength(1);
  });

  it("waits for approval of a high-impact plan update before any push (FR-4.11)", async () => {
    const { repo } = harness(
      aWork({
        planUpdate: {
          reason: "Potrzebna nowa zależność.",
          files: [
            { path: "package.json", change: "modify", why: "Zależność." },
          ],
          highImpact: { value: false, reasons: ["Model jej nie widzi."] },
        },
      }),
      aWork(),
    );
    repo.github.label(1, "plan:approved", "author");
    await repo.label(1, "agent:ready");
    expect(await repo.state(1)).toBe("awaiting-plan-approval");
    expect(repo.github.issues.get(1)?.labels).not.toContain("plan:approved");
    expect(repo.workspace.pushes).toEqual([]);
    const update = repo.comments(1).at(-1);
    expect(update).toContain("**Klasyfikacja:** high-impact.");
    expect(update).toContain("- reguła: manifest albo lockfile zależności");
    expect(await repo.label(1, "plan:approved")).toEqual(["developer"]);
    expect((await repo.run(1)).progress).toMatchObject({
      state: "gating",
      planVersion: 2,
      approvedPlanVersion: 2,
    });
    expect(repo.workspace.pushes).toHaveLength(1);
  });

  it("installs the dependencies before each session", async () => {
    const { repo } = harness();
    await repo.label(1, "agent:ready");
    await repo.gates(1, "failure");
    expect(repo.installs).toEqual(["npm ci", "npm ci"]);
  });

  it("escalates a failed install without a session", async () => {
    const { repo, developer } = harness();
    repo.installResult = { ok: false, output: "npm ERR! code ERESOLVE" };
    await repo.label(1, "agent:ready");
    expect(await repo.state(1)).toBe("needs-human");
    expect(developer.inputs).toEqual([]);
    expect(repo.workspace.pushes).toEqual([]);
  });

  it.each([
    [
      "a session that changed nothing",
      (repo: Harness) => {
        repo.workspace.changed = false;
      },
    ],
    [
      "a change of a denied path",
      (repo: Harness) => {
        repo.workspace.changes.push({
          path: ".github/workflows/gates.yml",
          additions: 1,
          deletions: 0,
          submodule: false,
        });
      },
    ],
    [
      "a nested repository",
      (repo: Harness) => {
        repo.workspace.changes.push({
          path: "vendor/lib",
          additions: 1,
          deletions: 0,
          submodule: true,
        });
      },
    ],
  ])("escalates %s without a push", async (_name, arrange) => {
    const { repo } = harness();
    arrange(repo);
    await repo.label(1, "agent:ready");
    expect(await repo.state(1)).toBe("needs-human");
    expect(repo.workspace.pushes).toEqual([]);
    expect(repo.github.drafts).toEqual([]);
  });
});
