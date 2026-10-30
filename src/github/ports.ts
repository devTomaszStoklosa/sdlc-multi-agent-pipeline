// Narrow interfaces over the GitHub API, one per kind of resource, so each job
// depends only on what it uses (ISP) and tests use an in-memory fake.

export const PERMISSION_LEVELS = [
  "none",
  "read",
  "triage",
  "write",
  "maintain",
  "admin",
] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export interface PermissionsPort {
  permissionOf(login: string): Promise<PermissionLevel>;
}

export interface IssueComment {
  id: number;
  body: string;
  authorLogin: string;
  // The GitHub App that wrote the comment, if any.
  appId?: number;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface CommentsPort {
  listComments(issue: number): Promise<IssueComment[]>;
  createComment(issue: number, body: string): Promise<IssueComment>;
  updateComment(id: number, body: string): Promise<IssueComment>;
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
}

export interface LabelEvent {
  actor: string;
  at: string;
}

// Issues and pull requests share labels and the label events.
export interface IssuesPort {
  getIssue(issue: number): Promise<IssueInfo>;
  listOpenIssuesWithLabel(label: string): Promise<number[]>;
  addLabels(issue: number, labels: readonly string[]): Promise<void>;
  // False when the label was not there.
  removeLabel(issue: number, label: string): Promise<boolean>;
  lastLabeled(issue: number, label: string): Promise<LabelEvent | undefined>;
}

export interface PullRequestInfo {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  headRef: string;
  headSha: string;
  // owner/name, undefined when the head repository was deleted.
  headRepo: string | undefined;
  labels: string[];
  url: string;
}

export interface NewPullRequest {
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface PullRequestsPort {
  getPull(pull: number): Promise<PullRequestInfo>;
  listOpenPulls(): Promise<PullRequestInfo[]>;
  createDraftPull(pull: NewPullRequest): Promise<PullRequestInfo>;
}

export type CheckConclusion = "success" | "failure" | "cancelled";

export interface CheckOutput {
  title: string;
  summary: string;
  detailsUrl?: string;
}

export interface CheckRunsPort {
  startCheckRun(name: string, headSha: string): Promise<number>;
  completeCheckRun(
    id: number,
    conclusion: CheckConclusion,
    output: CheckOutput,
  ): Promise<void>;
  // In-progress check runs of the given name that the app created.
  findInProgress(name: string, headSha: string): Promise<number[]>;
}

export interface WorkflowRunInfo {
  id: number;
  status: string;
  conclusion: string | null;
}

export interface WorkflowRunsPort {
  getRun(id: number): Promise<WorkflowRunInfo>;
  cancelRun(id: number): Promise<void>;
  forceCancelRun(id: number): Promise<void>;
  // The latest run of a workflow, by its name, for a head commit.
  findRunForSha(
    workflowName: string,
    sha: string,
  ): Promise<WorkflowRunInfo | undefined>;
}

export interface FileChange {
  branch: string;
  path: string;
  content: string;
  message: string;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  // The unified diff of the file; GitHub leaves it out for large or binary
  // files.
  patch?: string;
}

export interface ContentsPort {
  defaultBranch(): Promise<{ name: string; sha: string }>;
  // The files that `head` changes since its merge base with `base`.
  compare(base: string, head: string): Promise<ChangedFile[]>;
  readFile(path: string, ref: string): Promise<string | undefined>;
  branchExists(name: string): Promise<boolean>;
  createBranch(name: string, sha: string): Promise<void>;
  // Commits one file on a branch and returns the new commit SHA.
  writeFile(change: FileChange): Promise<string>;
}
