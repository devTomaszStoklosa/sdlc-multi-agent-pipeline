import type { Octokit } from "@octokit/rest";
import {
  PERMISSION_LEVELS,
  type CommentsPort,
  type IssueComment,
  type IssueInfo,
  type IssuesPort,
  type LabelEvent,
  type NewPullRequest,
  type PermissionLevel,
  type PermissionsPort,
  type PullRequestInfo,
  type PullRequestsPort,
} from "./ports.ts";

export interface Repo {
  owner: string;
  repo: string;
}

export function parseRepository(fullName: string): Repo {
  const [owner = "", repo = "", ...rest] = fullName.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Invalid repository name: ${fullName}`);
  }
  return { owner, repo };
}

export function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === status
  );
}

// The repository that the calls of a port go to.
export abstract class RepoApi {
  protected readonly octokit: Octokit;
  protected readonly repo: Repo;

  constructor(octokit: Octokit, repo: Repo) {
    this.octokit = octokit;
    this.repo = repo;
  }
}

type Label = string | { name?: string };

function labelNames(labels: readonly Label[]): string[] {
  return labels
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter((name) => name !== "");
}

function isPermissionLevel(value: string): value is PermissionLevel {
  return (PERMISSION_LEVELS as readonly string[]).includes(value);
}

export class GitHubPermissions extends RepoApi implements PermissionsPort {
  // A custom role name falls back to the base permission it extends.
  async permissionOf(login: string): Promise<PermissionLevel> {
    try {
      const { data } =
        await this.octokit.rest.repos.getCollaboratorPermissionLevel({
          ...this.repo,
          username: login,
        });
      const role = data.role_name;
      if (isPermissionLevel(role)) return role;
      return isPermissionLevel(data.permission) ? data.permission : "none";
    } catch (error) {
      if (hasStatus(error, 404)) return "none";
      throw error;
    }
  }
}

export class GitHubComments extends RepoApi implements CommentsPort {
  async listComments(issue: number): Promise<IssueComment[]> {
    const comments = await this.octokit.paginate(
      this.octokit.rest.issues.listComments,
      { ...this.repo, issue_number: issue, per_page: 100 },
    );
    return comments.map(toComment);
  }

  async createComment(issue: number, body: string): Promise<IssueComment> {
    const { data } = await this.octokit.rest.issues.createComment({
      ...this.repo,
      issue_number: issue,
      body,
    });
    return toComment(data);
  }

  async updateComment(id: number, body: string): Promise<IssueComment> {
    const { data } = await this.octokit.rest.issues.updateComment({
      ...this.repo,
      comment_id: id,
      body,
    });
    return toComment(data);
  }
}

interface RawComment {
  id: number;
  body?: string;
  user: { login: string } | null;
  performed_via_github_app?: { id: number } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

function toComment(comment: RawComment): IssueComment {
  return {
    id: comment.id,
    body: comment.body ?? "",
    authorLogin: comment.user?.login ?? "",
    appId: comment.performed_via_github_app?.id,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    url: comment.html_url,
  };
}

export class GitHubIssues extends RepoApi implements IssuesPort {
  async getIssue(issue: number): Promise<IssueInfo> {
    const { data } = await this.octokit.rest.issues.get({
      ...this.repo,
      issue_number: issue,
    });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      state: data.state === "open" ? "open" : "closed",
      labels: labelNames(data.labels),
    };
  }

  async listOpenIssuesWithLabel(label: string): Promise<number[]> {
    const issues = await this.octokit.paginate(
      this.octokit.rest.issues.listForRepo,
      { ...this.repo, state: "open", labels: label, per_page: 100 },
    );
    return issues
      .filter((issue) => issue.pull_request === undefined)
      .map((issue) => issue.number);
  }

  async addLabels(issue: number, labels: readonly string[]): Promise<void> {
    await this.octokit.rest.issues.addLabels({
      ...this.repo,
      issue_number: issue,
      labels: [...labels],
    });
  }

  async removeLabel(issue: number, label: string): Promise<boolean> {
    try {
      await this.octokit.rest.issues.removeLabel({
        ...this.repo,
        issue_number: issue,
        name: label,
      });
      return true;
    } catch (error) {
      if (hasStatus(error, 404)) return false;
      throw error;
    }
  }

  async lastLabeled(
    issue: number,
    label: string,
  ): Promise<LabelEvent | undefined> {
    const events = await this.octokit.paginate(
      this.octokit.rest.issues.listEvents,
      { ...this.repo, issue_number: issue, per_page: 100 },
    );
    const last = events
      .filter(
        (event) =>
          event.event === "labeled" &&
          "label" in event &&
          event.label.name === label,
      )
      .at(-1);
    return last && { actor: last.actor.login, at: last.created_at };
  }
}

interface RawPull {
  number: number;
  state: string;
  merged_at: string | null;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  labels: Label[];
  html_url: string;
}

function toPull(pull: RawPull): PullRequestInfo {
  return {
    number: pull.number,
    state: pull.state === "open" ? "open" : "closed",
    merged: pull.merged_at !== null,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    headRepo: pull.head.repo?.full_name,
    labels: labelNames(pull.labels),
    url: pull.html_url,
  };
}

export class GitHubPulls extends RepoApi implements PullRequestsPort {
  async getPull(pull: number): Promise<PullRequestInfo> {
    const { data } = await this.octokit.rest.pulls.get({
      ...this.repo,
      pull_number: pull,
    });
    return toPull(data);
  }

  async listOpenPulls(): Promise<PullRequestInfo[]> {
    const pulls = await this.octokit.paginate(this.octokit.rest.pulls.list, {
      ...this.repo,
      state: "open",
      per_page: 100,
    });
    return pulls.map(toPull);
  }

  async createDraftPull(pull: NewPullRequest): Promise<PullRequestInfo> {
    const { data } = await this.octokit.rest.pulls.create({
      ...this.repo,
      ...pull,
      draft: true,
    });
    return toPull(data);
  }
}
