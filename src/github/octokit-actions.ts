import type { Octokit } from "@octokit/rest";
import { hasStatus, RepoApi, type Repo } from "./octokit-issues.ts";
import type {
  CheckConclusion,
  CheckOutput,
  ChangedFile,
  CheckRunsPort,
  ContentsPort,
  FileChange,
  WorkflowJobInfo,
  WorkflowRunInfo,
  WorkflowRunsPort,
} from "./ports.ts";

export class GitHubCheckRuns extends RepoApi implements CheckRunsPort {
  private readonly appId: number;

  constructor(octokit: Octokit, repo: Repo, appId: number) {
    super(octokit, repo);
    this.appId = appId;
  }

  async startCheckRun(name: string, headSha: string): Promise<number> {
    const { data } = await this.octokit.rest.checks.create({
      ...this.repo,
      name,
      head_sha: headSha,
      status: "in_progress",
    });
    return data.id;
  }

  async completeCheckRun(
    id: number,
    conclusion: CheckConclusion,
    output: CheckOutput,
  ): Promise<void> {
    await this.octokit.rest.checks.update({
      ...this.repo,
      check_run_id: id,
      status: "completed",
      conclusion,
      details_url: output.detailsUrl,
      output: { title: output.title, summary: output.summary },
    });
  }

  async findInProgress(name: string, headSha: string): Promise<number[]> {
    const { data } = await this.octokit.rest.checks.listForRef({
      ...this.repo,
      ref: headSha,
      check_name: name,
      status: "in_progress",
      app_id: this.appId,
      per_page: 100,
    });
    return data.check_runs.map((run) => run.id);
  }
}

export class GitHubWorkflowRuns extends RepoApi implements WorkflowRunsPort {
  async getRun(id: number): Promise<WorkflowRunInfo> {
    const { data } = await this.octokit.rest.actions.getWorkflowRun({
      ...this.repo,
      run_id: id,
    });
    return {
      id: data.id,
      status: data.status ?? "",
      conclusion: data.conclusion,
    };
  }

  async listJobs(runId: number): Promise<WorkflowJobInfo[]> {
    const jobs = await this.octokit.paginate(
      this.octokit.rest.actions.listJobsForWorkflowRun,
      { ...this.repo, run_id: runId, filter: "latest", per_page: 100 },
    );
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
    }));
  }

  async jobLog(jobId: number): Promise<string> {
    const { data } =
      await this.octokit.rest.actions.downloadJobLogsForWorkflowRun({
        ...this.repo,
        job_id: jobId,
      });
    return typeof data === "string" ? data : String(data);
  }

  // A run that has already completed cannot be cancelled (409).
  async cancelRun(id: number): Promise<void> {
    try {
      await this.octokit.rest.actions.cancelWorkflowRun({
        ...this.repo,
        run_id: id,
      });
    } catch (error) {
      if (!hasStatus(error, 409)) throw error;
    }
  }

  async forceCancelRun(id: number): Promise<void> {
    try {
      await this.octokit.rest.actions.forceCancelWorkflowRun({
        ...this.repo,
        run_id: id,
      });
    } catch (error) {
      if (!hasStatus(error, 409)) throw error;
    }
  }

  async findRunForSha(
    workflowName: string,
    sha: string,
  ): Promise<WorkflowRunInfo | undefined> {
    const { data } = await this.octokit.rest.actions.listWorkflowRunsForRepo({
      ...this.repo,
      head_sha: sha,
      per_page: 100,
    });
    const run = data.workflow_runs.find(
      (candidate) => candidate.name === workflowName,
    );
    if (run === undefined) return undefined;
    return { id: run.id, status: run.status ?? "", conclusion: run.conclusion };
  }
}

export class GitHubContents extends RepoApi implements ContentsPort {
  async defaultBranch(): Promise<{ name: string; sha: string }> {
    const { data: repository } = await this.octokit.rest.repos.get({
      ...this.repo,
    });
    const { data: branch } = await this.octokit.rest.repos.getBranch({
      ...this.repo,
      branch: repository.default_branch,
    });
    return { name: branch.name, sha: branch.commit.sha };
  }

  async compare(base: string, head: string): Promise<ChangedFile[]> {
    const { data } = await this.octokit.rest.repos.compareCommitsWithBasehead({
      ...this.repo,
      basehead: `${base}...${head}`,
    });
    return (data.files ?? []).map((file) => ({
      path: file.filename,
      previousPath: file.previous_filename,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));
  }

  async readFile(path: string, ref: string): Promise<string | undefined> {
    const file = await this.file(path, ref);
    return file && Buffer.from(file.content, "base64").toString("utf8");
  }

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.octokit.rest.git.getRef({
        ...this.repo,
        ref: `heads/${name}`,
      });
      return true;
    } catch (error) {
      if (hasStatus(error, 404)) return false;
      throw error;
    }
  }

  async createBranch(name: string, sha: string): Promise<void> {
    await this.octokit.rest.git.createRef({
      ...this.repo,
      ref: `refs/heads/${name}`,
      sha,
    });
  }

  async writeFile(change: FileChange): Promise<string> {
    const existing = await this.file(change.path, change.branch);
    const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
      ...this.repo,
      path: change.path,
      branch: change.branch,
      message: change.message,
      content: Buffer.from(change.content, "utf8").toString("base64"),
      sha: existing?.sha,
    });
    const sha = data.commit.sha;
    if (sha === undefined) throw new Error("GitHub returned no commit SHA.");
    return sha;
  }

  private async file(
    path: string,
    ref: string,
  ): Promise<{ content: string; sha: string } | undefined> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        ...this.repo,
        path,
        ref,
      });
      if (Array.isArray(data) || data.type !== "file") return undefined;
      return { content: data.content, sha: data.sha };
    } catch (error) {
      if (hasStatus(error, 404)) return undefined;
      throw error;
    }
  }
}
