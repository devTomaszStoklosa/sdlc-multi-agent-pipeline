import { Octokit } from "@octokit/rest";
import {
  GitHubCheckRuns,
  GitHubContents,
  GitHubWorkflowRuns,
} from "./octokit-actions.ts";
import {
  GitHubComments,
  GitHubIssues,
  GitHubPermissions,
  GitHubPulls,
  parseRepository,
} from "./octokit-issues.ts";
import type {
  CheckRunsPort,
  CommentsPort,
  ContentsPort,
  IssuesPort,
  PermissionsPort,
  PullRequestsPort,
  WorkflowRunsPort,
} from "./ports.ts";

export interface GitHub {
  permissions: PermissionsPort;
  comments: CommentsPort;
  issues: IssuesPort;
  pulls: PullRequestsPort;
  checks: CheckRunsPort;
  runs: WorkflowRunsPort;
  contents: ContentsPort;
}

function noop(): void {
  // Intentionally empty.
}

export interface ClientOptions {
  token: string;
  repository: string;
  appId: number;
  baseUrl?: string;
}

// All ports of one token. A job builds one client per token it has, so the
// scope of each call is the scope of the token behind it (SEC-8.1).
export function createGitHub(options: ClientOptions): GitHub {
  // The ports handle expected errors such as 404 themselves and throw the
  // others, so Octokit does not log failed requests.
  const octokit = new Octokit({
    auth: options.token,
    baseUrl: options.baseUrl,
    userAgent: "sdlc-multi-agent-pipeline",
    log: { debug: noop, info: noop, warn: console.warn, error: noop },
  });
  const repo = parseRepository(options.repository);
  return {
    permissions: new GitHubPermissions(octokit, repo),
    comments: new GitHubComments(octokit, repo),
    issues: new GitHubIssues(octokit, repo),
    pulls: new GitHubPulls(octokit, repo),
    checks: new GitHubCheckRuns(octokit, repo, options.appId),
    runs: new GitHubWorkflowRuns(octokit, repo),
    contents: new GitHubContents(octokit, repo),
  };
}
