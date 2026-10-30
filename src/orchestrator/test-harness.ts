// A demo repository in memory for the orchestrator tests: it runs the jobs of
// orchestrate.yml in their order on the in-memory GitHub, with the stub roles.
import type { RoleRunner } from "../agents/role-runner.ts";
import { StubRoleRunner } from "../agents/stub-role.ts";
import { MemoryRunEventLog } from "../audit/run-events.ts";
import { BASELINE } from "../config/fixtures.ts";
import { CommentRunStateStore } from "../core/run-store/comment-store.ts";
import type { RunRecord } from "../core/run-store/run-record.ts";
import type { RunStateName } from "../core/state-machine/states.ts";
import { FAKE_REPOSITORY, FakeGitHub } from "../github/fake.ts";
import type { Role } from "../hooks/roles.ts";
import { advance } from "./advance.ts";
import { decide, type DecideContext } from "./decide.ts";
import { filterEvent, type GitHubEvent } from "./filter.ts";
import { runRoleJob, type RoleJobContext } from "./role-job.ts";
import { roleJobOutputSchema } from "./role-output.ts";
import { CONFIG_PATH } from "./start-run.ts";

export const REPO = FAKE_REPOSITORY;
export const AUTHOR = { login: "author", type: "User" };
export const CONFIG = `version: 1
commands:
  install: npm ci
  test: npm test
  lint: npm run lint
  format: npx prettier --write --ignore-unknown
`;

export class Harness {
  readonly github: FakeGitHub;
  readonly log = new MemoryRunEventLog();
  readonly store: CommentRunStateStore;
  // The roles of the role jobs; tests may replace them.
  runner: RoleRunner = new StubRoleRunner(() => Promise.resolve());
  private time = new Date("2026-10-29T10:00:00Z");
  private nextRun = 100;

  constructor(config = CONFIG) {
    this.github = new FakeGitHub(() => this.time);
    this.store = new CommentRunStateStore(this.github, this.github.appId);
    this.setConfig(config);
    this.github.permissions.set(AUTHOR.login, "admin");
    this.github.addIssue(1, { title: "Add a discount" });
  }

  setConfig(text: string): void {
    const main = this.github.branches.get("main") ?? "";
    this.github.files.set(`${main}:${CONFIG_PATH}`, text);
  }

  // Moves `main` to a new commit, which a run started later reads.
  commitToMain(config: string): void {
    const sha = (this.nextRun++).toString(16).padStart(7, "c");
    this.github.branches.set("main", sha);
    this.setConfig(config);
  }

  tick(minutes: number): void {
    this.time = new Date(this.time.getTime() + minutes * 60_000);
  }

  now(): Date {
    return this.time;
  }

  context(workflowRunId: number): DecideContext & RoleJobContext {
    return {
      repository: REPO,
      app: this.github.ports(),
      read: this.github.ports(),
      store: this.store,
      log: this.log,
      baseline: BASELINE,
      now: () => this.time,
      workflowRunId,
      gatesWorkflow: "Gates",
      runner: this.runner,
      appId: this.github.appId,
      // Checks between the steps of a test, as the sessions here take no time.
      stopWatch: {
        intervalMs: 0,
        wait: () =>
          new Promise((resolve) => {
            setImmediate(resolve);
          }),
      },
    };
  }

  // One run of orchestrate.yml: filter, decide and up to two role jobs, each
  // followed by its advance job. Returns the roles that ran.
  async orchestrate(event: GitHubEvent): Promise<Role[]> {
    const id = this.nextRun++;
    this.github.addRun(id, { name: "Orchestrate" });
    const roles: Role[] = [];
    const filtered = filterEvent(event, REPO);
    if (filtered.proceed) {
      const context = this.context(id);
      let next = await decide(context, filtered.issue, event);
      for (let job = 0; job < 2 && next.role !== undefined; job++) {
        roles.push(next.role);
        const output = await runRoleJob(context, filtered.issue, next.role);
        const handed = roleJobOutputSchema.parse(
          JSON.parse(JSON.stringify(output)),
        );
        next = await advance(context, filtered.issue, handed);
      }
    }
    this.github.completeRun(id, "success");
    return roles;
  }

  async label(issue: number, name: string, sender = AUTHOR): Promise<Role[]> {
    this.github.label(issue, name, sender.login);
    return this.orchestrate({
      name: "issues",
      payload: {
        action: "labeled",
        issue: { number: issue },
        label: { name },
        sender,
      },
    });
  }

  async unlabel(issue: number, name: string, sender = AUTHOR): Promise<Role[]> {
    await this.github.removeLabel(issue, name);
    return this.orchestrate({
      name: "issues",
      payload: {
        action: "unlabeled",
        issue: { number: issue },
        label: { name },
        sender,
      },
    });
  }

  async comment(
    issue: number,
    user = AUTHOR,
    association = "OWNER",
  ): Promise<Role[]> {
    return this.orchestrate({
      name: "issue_comment",
      payload: {
        action: "created",
        issue: { number: issue },
        comment: { author_association: association, user },
      },
    });
  }

  // The gates workflow finishes on the last push of the run.
  async gates(
    issue: number,
    conclusion: "success" | "failure",
  ): Promise<Role[]> {
    const run = await this.run(issue);
    const sha = run.progress.pushedSha ?? "";
    this.github.addRun(this.nextRun++, {
      name: "Gates",
      headSha: sha,
      status: "completed",
      conclusion,
    });
    return this.orchestrate({
      name: "workflow_run",
      payload: {
        action: "completed",
        workflow_run: {
          head_branch: run.branch,
          head_sha: sha,
          conclusion,
          head_repository: { full_name: REPO },
        },
      },
    });
  }

  async dispatch(issue: number, sender = AUTHOR): Promise<Role[]> {
    return this.orchestrate({
      name: "workflow_dispatch",
      payload: { inputs: { issue: String(issue) }, sender },
    });
  }

  async record(issue: number): Promise<RunRecord | undefined> {
    return (await this.store.read(issue))?.record;
  }

  async run(issue: number): Promise<RunRecord["run"]> {
    const record = await this.record(issue);
    if (record === undefined)
      throw new Error(`Issue #${String(issue)} has no run.`);
    return record.run;
  }

  async state(issue: number): Promise<RunStateName | undefined> {
    return (await this.record(issue))?.run.progress.state;
  }

  async states(issue: number): Promise<RunStateName[]> {
    return (await this.run(issue)).history.map((entry) => entry.state);
  }

  comments(issue: number): string[] {
    return this.github.comments
      .filter(
        (comment) =>
          comment.issue === issue && !comment.body.includes("sdlc-run-state"),
      )
      .map((comment) => comment.body);
  }

  setScenario(issue: number, yaml: string): void {
    const found = this.github.issues.get(issue);
    if (found) found.body = `Test issue.\n\n<!-- sdlc-stub\n${yaml}\n-->\n`;
  }
}
