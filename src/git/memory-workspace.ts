import type {
  PrepareSpec,
  RunWorkspace,
  WorkspaceChange,
} from "./workspace.ts";

// A workspace in memory for the orchestrator tests: a session "changes" the
// files in `changes`, and each commit and push is recorded.
export class MemoryWorkspace implements RunWorkspace {
  changes: WorkspaceChange[] = [
    { path: "src/price.ts", additions: 10, deletions: 2, submodule: false },
  ];
  // Files that conflict after a merge of the main branch, and those that the
  // session leaves unresolved.
  conflicts: string[] = [];
  markers: string[] = [];
  // False when the session changed nothing.
  changed = true;
  readonly prepared: PrepareSpec[] = [];
  readonly commits: string[] = [];
  readonly pushes: { branch: string; sha: string }[] = [];
  private next = 1;

  prepare(spec: PrepareSpec): Promise<string[]> {
    this.prepared.push(spec);
    return Promise.resolve(spec.merge === undefined ? [] : [...this.conflicts]);
  }

  unresolved(paths: readonly string[]): Promise<string[]> {
    return Promise.resolve(paths.filter((file) => this.markers.includes(file)));
  }

  commit(message: string): Promise<boolean> {
    if (this.changed) this.commits.push(message);
    return Promise.resolve(this.changed);
  }

  diff(): Promise<WorkspaceChange[]> {
    return Promise.resolve([...this.changes]);
  }

  push(branch: string): Promise<string> {
    const sha = (this.next++).toString(16).padStart(7, "d");
    this.pushes.push({ branch, sha });
    return Promise.resolve(sha);
  }
}
