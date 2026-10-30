import type { GitHub } from "./client.ts";
import type {
  ChangedFile,
  CheckConclusion,
  CheckOutput,
  CheckRunsPort,
  CommentsPort,
  ContentsPort,
  FileChange,
  IssueComment,
  IssueInfo,
  IssuesPort,
  LabelEvent,
  NewPullRequest,
  PermissionLevel,
  PermissionsPort,
  PullRequestInfo,
  PullRequestsPort,
  WorkflowRunInfo,
  WorkflowRunsPort,
} from "./ports.ts";

interface FakeCheckRun {
  name: string;
  headSha: string;
  status: "in_progress" | "completed";
  conclusion?: CheckConclusion;
  output?: CheckOutput;
}

interface FakeRun extends WorkflowRunInfo {
  name?: string;
  headSha?: string;
}

export const FAKE_REPOSITORY = "owner/demo";

// GitHub in memory for tests. Every write is recorded in `writes`, so a test
// can check that nothing happened after a run stopped.
export class FakeGitHub
  implements
    PermissionsPort,
    CommentsPort,
    IssuesPort,
    PullRequestsPort,
    CheckRunsPort,
    WorkflowRunsPort,
    ContentsPort
{
  readonly appId = 7;
  readonly permissions = new Map<string, PermissionLevel>();
  readonly issues = new Map<number, IssueInfo>();
  readonly pulls = new Map<number, PullRequestInfo>();
  readonly comments: (IssueComment & { issue: number })[] = [];
  readonly labelEvents: { issue: number; label: string; event: LabelEvent }[] =
    [];
  readonly checkRuns = new Map<number, FakeCheckRun>();
  readonly runs = new Map<number, FakeRun>();
  readonly branches = new Map<string, string>([["main", "0000000"]]);
  readonly files = new Map<string, string>();
  // The files each branch changes against `main`, by branch name.
  readonly diffs = new Map<string, ChangedFile[]>();
  readonly writes: string[] = [];
  // Whether a write by the app counts as a comment of the app.
  commentAppId: number | undefined = this.appId;
  // Hooks that tests use to change GitHub between two calls.
  onCancel: (id: number) => void = (id) => {
    this.completeRun(id, "cancelled");
  };
  private nextId = 1000;
  private readonly clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  // The fake as the ports of one token.
  ports(): GitHub {
    return {
      permissions: this,
      comments: this,
      issues: this,
      pulls: this,
      checks: this,
      runs: this,
      contents: this,
    };
  }

  addIssue(number: number, fields: Partial<IssueInfo> = {}): IssueInfo {
    const issue: IssueInfo = {
      number,
      title: `Issue ${String(number)}`,
      body: "",
      state: "open",
      labels: [],
      ...fields,
    };
    this.issues.set(number, issue);
    return issue;
  }

  addPull(fields: Partial<PullRequestInfo> & { number: number }) {
    const pull: PullRequestInfo = {
      state: "open",
      merged: false,
      headRef: "chore/1-stub-run",
      headSha: "1111111",
      headRepo: FAKE_REPOSITORY,
      labels: [],
      url: `https://github.test/pull/${String(fields.number)}`,
      ...fields,
    };
    this.pulls.set(pull.number, pull);
    return pull;
  }

  label(issue: number, label: string, actor: string): void {
    const target = this.labelTarget(issue);
    if (!target.labels.includes(label)) target.labels.push(label);
    this.labelEvents.push({
      issue,
      label,
      event: { actor, at: this.clock().toISOString() },
    });
  }

  addRun(id: number, fields: Partial<FakeRun> = {}): void {
    this.runs.set(id, {
      id,
      status: "in_progress",
      conclusion: null,
      ...fields,
    });
  }

  completeRun(id: number, conclusion: string): void {
    const run = this.runs.get(id);
    if (run) Object.assign(run, { status: "completed", conclusion });
  }

  // PermissionsPort

  permissionOf(login: string): Promise<PermissionLevel> {
    return Promise.resolve(this.permissions.get(login) ?? "none");
  }

  // CommentsPort

  listComments(issue: number): Promise<IssueComment[]> {
    return Promise.resolve(
      this.comments.filter((comment) => comment.issue === issue),
    );
  }

  createComment(issue: number, body: string): Promise<IssueComment> {
    this.writes.push(`comment #${String(issue)}`);
    const id = this.nextId++;
    const at = this.clock().toISOString();
    const comment = {
      issue,
      id,
      body,
      authorLogin: "pipeline[bot]",
      appId: this.commentAppId,
      createdAt: at,
      updatedAt: at,
      url: `https://github.test/issues/${String(issue)}#issuecomment-${String(id)}`,
    };
    this.comments.push(comment);
    return Promise.resolve(comment);
  }

  updateComment(id: number, body: string): Promise<IssueComment> {
    const comment = this.comments.find((candidate) => candidate.id === id);
    if (comment === undefined) throw new Error(`No comment ${String(id)}`);
    Object.assign(comment, { body, updatedAt: this.clock().toISOString() });
    return Promise.resolve(comment);
  }

  // IssuesPort

  getIssue(issue: number): Promise<IssueInfo> {
    const found = this.issues.get(issue);
    if (found === undefined) throw new Error(`No issue ${String(issue)}`);
    return Promise.resolve(structuredClone(found));
  }

  listOpenIssuesWithLabel(label: string): Promise<number[]> {
    const numbers = [...this.issues.values()]
      .filter((issue) => issue.state === "open" && issue.labels.includes(label))
      .map((issue) => issue.number);
    return Promise.resolve(numbers);
  }

  addLabels(issue: number, labels: readonly string[]): Promise<void> {
    this.writes.push(`labels+ #${String(issue)} ${labels.join(",")}`);
    for (const label of labels) this.label(issue, label, "pipeline[bot]");
    return Promise.resolve();
  }

  removeLabel(issue: number, label: string): Promise<boolean> {
    this.writes.push(`labels- #${String(issue)} ${label}`);
    const target = this.labelTarget(issue);
    const had = target.labels.includes(label);
    target.labels = target.labels.filter((name) => name !== label);
    return Promise.resolve(had);
  }

  lastLabeled(issue: number, label: string): Promise<LabelEvent | undefined> {
    const events = this.labelEvents.filter(
      (entry) => entry.issue === issue && entry.label === label,
    );
    return Promise.resolve(events.at(-1)?.event);
  }

  // PullRequestsPort

  getPull(pull: number): Promise<PullRequestInfo> {
    const found = this.pulls.get(pull);
    if (found === undefined) throw new Error(`No pull request ${String(pull)}`);
    return Promise.resolve(structuredClone(found));
  }

  listOpenPulls(): Promise<PullRequestInfo[]> {
    const open = [...this.pulls.values()].filter(
      (pull) => pull.state === "open",
    );
    return Promise.resolve(structuredClone(open));
  }

  createDraftPull(pull: NewPullRequest): Promise<PullRequestInfo> {
    this.writes.push(`pull ${pull.head}`);
    const number = this.nextId++;
    const sha = this.branches.get(pull.head) ?? "0000000";
    return Promise.resolve(
      this.addPull({ number, headRef: pull.head, headSha: sha }),
    );
  }

  // CheckRunsPort

  startCheckRun(name: string, headSha: string): Promise<number> {
    this.writes.push(`check ${name} start`);
    const id = this.nextId++;
    this.checkRuns.set(id, { name, headSha, status: "in_progress" });
    return Promise.resolve(id);
  }

  completeCheckRun(
    id: number,
    conclusion: CheckConclusion,
    output: CheckOutput,
  ): Promise<void> {
    this.writes.push(`check ${String(id)} ${conclusion}`);
    const run = this.checkRuns.get(id);
    if (run) Object.assign(run, { status: "completed", conclusion, output });
    return Promise.resolve();
  }

  findInProgress(name: string, headSha: string): Promise<number[]> {
    const ids = [...this.checkRuns]
      .filter(
        ([, run]) =>
          run.name === name &&
          run.headSha === headSha &&
          run.status === "in_progress",
      )
      .map(([id]) => id);
    return Promise.resolve(ids);
  }

  // WorkflowRunsPort

  getRun(id: number): Promise<WorkflowRunInfo> {
    const run = this.runs.get(id);
    if (run === undefined) throw new Error(`No workflow run ${String(id)}`);
    return Promise.resolve({ ...run });
  }

  cancelRun(id: number): Promise<void> {
    this.onCancel(id);
    return Promise.resolve();
  }

  forceCancelRun(id: number): Promise<void> {
    this.completeRun(id, "cancelled");
    return Promise.resolve();
  }

  findRunForSha(
    workflowName: string,
    sha: string,
  ): Promise<WorkflowRunInfo | undefined> {
    const run = [...this.runs.values()].findLast(
      (candidate) =>
        candidate.name === workflowName && candidate.headSha === sha,
    );
    return Promise.resolve(run && { ...run });
  }

  // ContentsPort

  defaultBranch(): Promise<{ name: string; sha: string }> {
    return Promise.resolve({
      name: "main",
      sha: this.branches.get("main") ?? "",
    });
  }

  compare(_base: string, head: string): Promise<ChangedFile[]> {
    return Promise.resolve(this.diffs.get(head) ?? []);
  }

  readFile(path: string, ref: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(`${ref}:${path}`));
  }

  branchExists(name: string): Promise<boolean> {
    return Promise.resolve(this.branches.has(name));
  }

  createBranch(name: string, sha: string): Promise<void> {
    this.writes.push(`branch ${name}`);
    this.branches.set(name, sha);
    return Promise.resolve();
  }

  writeFile(change: FileChange): Promise<string> {
    this.writes.push(`push ${change.branch}`);
    const sha = (this.nextId++).toString(16).padStart(7, "a");
    this.branches.set(change.branch, sha);
    this.files.set(`${change.branch}:${change.path}`, change.content);
    for (const pull of this.pulls.values()) {
      if (pull.headRef === change.branch) pull.headSha = sha;
    }
    return Promise.resolve(sha);
  }

  private labelTarget(issue: number): { labels: string[] } {
    const target = this.issues.get(issue) ?? this.pulls.get(issue);
    if (target === undefined) throw new Error(`No issue ${String(issue)}`);
    return target;
  }
}
