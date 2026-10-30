// A job of the gates workflow that failed on the run's last push, with the
// end of its log (FR-4.12).
export interface GateFailure {
  job: string;
  log: string;
}

// What the job gathers for a Developer session: only the data the task needs
// (SEC-8.10). The plan and the gate logs are untrusted (SEC-8.5).
export interface DeveloperBrief {
  kind: "developer";
  // The plan comment of the version the Developer implements (FR-4.3).
  plan: { version: number; body: string };
  // The run's branch, which the workspace holds, if the run has one.
  branch?: string;
  gateFailures: GateFailure[];
  // Files that still conflict after the job merged the main branch into the
  // branch of an earlier run (FR-4.28b).
  conflicts: string[];
  // The commands of the run's configuration that the session runs itself.
  commands: { install: string; lint: string; test: string };
}
