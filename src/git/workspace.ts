import type { ChangedFile } from "../github/ports.ts";

export interface PrepareSpec {
  // The run's branch, if it exists on the remote; otherwise the workspace
  // stays on the main branch, where the job's checkout put it.
  branch?: string;
  // Merges the main branch into the branch of an earlier run (FR-4.28b).
  merge?: { main: string; message: string };
}

// A file of the pull request's diff against the main branch.
export interface WorkspaceChange extends ChangedFile {
  // A nested repository, which the pipeline does not push.
  submodule: boolean;
}

// The workspace of a Developer session as the job sees it. The job keeps its
// own git directory outside the workspace, so the session cannot change the
// git configuration or the hooks that the job's git commands use (plan 3.4).
export interface RunWorkspace {
  // Before the session: takes the git directory out of the workspace, checks
  // out the run's branch and merges the main branch into it. Returns the
  // files that still conflict, for the session to resolve.
  prepare(spec: PrepareSpec): Promise<string[]>;
  // After the session: the files among `paths` that still hold conflict
  // markers.
  unresolved(paths: readonly string[]): Promise<string[]>;
  // Commits the session's changes, after the merge commit of resolved
  // conflicts. False when there is nothing new to push.
  commit(message: string): Promise<boolean>;
  // What the branch changes against the main branch, as its pull request
  // shows it.
  diff(main: string): Promise<WorkspaceChange[]>;
  // Pushes the branch without force and returns its new head commit.
  push(branch: string): Promise<string>;
}
