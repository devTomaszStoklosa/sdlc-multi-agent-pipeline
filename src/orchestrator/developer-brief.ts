import type { DeveloperBrief, GateFailure } from "../agents/developer/brief.ts";
import { planManifests } from "../agents/developer/manifests.ts";
import type { OrgBaseline } from "../config/schema.ts";
import type { RunRecord } from "../core/run-store/run-record.ts";
import type { RunWorkspace } from "../git/workspace.ts";
import type { CommandRunner } from "../hooks/commands.ts";
import type { ContentsPort, WorkflowRunsPort } from "../github/ports.ts";
import { redactText } from "../hooks/redact.ts";
import { mergeMessage } from "./developer-commit.ts";
import { runConfig } from "./limits.ts";
import { openReview, type ReviewSources } from "./review-history.ts";
import { runPlan } from "./run-plan.ts";
import { StageError } from "./stage-error.ts";

const MAX_FAILED_JOBS = 5;
const MAX_LOG = 12_000;
const MAX_INSTALL_OUTPUT = 1500;
// GitHub starts every log line with a time stamp.
const TIME_STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z /gm;

export interface DeveloperSources extends ReviewSources {
  contents: ContentsPort;
  // The job's read-only workflow token, which may read the gate logs.
  runs: WorkflowRunsPort;
  workspace: RunWorkspace;
  // Runs the install command in bubblewrap with the network (plan 3.4).
  installer: CommandRunner;
  baseline: OrgBaseline;
  // The name of the repository's gates workflow (plan 3.5).
  gatesWorkflow: string;
}

function tail(log: string): string {
  const text = redactText(log.replace(TIME_STAMP, "")).value;
  return text.length > MAX_LOG ? `…${text.slice(-MAX_LOG)}` : text;
}

// The failed jobs of the gates of the run's last push, which send their result
// back to the Developer (FR-4.12). Gates that passed send none.
async function gateFailures(
  sources: DeveloperSources,
  pushedSha: string | undefined,
): Promise<GateFailure[]> {
  if (pushedSha === undefined) return [];
  const gates = await sources.runs.findRunForSha(
    sources.gatesWorkflow,
    pushedSha,
  );
  if (gates?.status !== "completed" || gates.conclusion !== "failure") {
    return [];
  }
  const failed = (await sources.runs.listJobs(gates.id))
    .filter((job) => job.conclusion === "failure")
    .slice(0, MAX_FAILED_JOBS);
  return Promise.all(
    failed.map(async (job) => ({
      job: job.name,
      log: tail(await sources.runs.jobLog(job.id)),
    })),
  );
}

// The dependencies, installed by the job before the session: the sandbox of
// the session mounts `node_modules/.bin` read-only, so the session cannot
// install them itself. After a change of a planned manifest, the
// `PostToolUse` hook installs them again (#49).
async function install(sources: DeveloperSources, command: string) {
  const result = await sources.installer.run(command, []);
  if (result.ok) return;
  const output = redactText(result.output).value.slice(-MAX_INSTALL_OUTPUT);
  throw new StageError(`The install command \`${command}\` failed:\n${output}`);
}

// A plan that changes a dependency manifest needs the command that updates
// the lockfile after the write (#49). Without it no session can leave the
// branch consistent, so the stage escalates before the session (#58).
function checkLockfileCommand(
  manifests: readonly string[],
  command: string | undefined,
) {
  if (manifests.length === 0 || command !== undefined) return;
  throw new StageError(
    `The plan changes ${manifests.join(", ")}, and the configuration has no commands.update_lockfile.`,
    "missing-update-lockfile",
  );
}

// What a Developer session gets besides the issue (SEC-8.10): the plan
// version it implements, the failed gates of its last push, the open findings
// of the latest review (FR-4.15) and the conflicts left by merging the main
// branch into the branch of an earlier run, which the job does before the
// session (FR-4.28b), with the dependencies installed.
export async function developerBrief(
  sources: DeveloperSources,
  record: RunRecord,
): Promise<DeveloperBrief> {
  const { run } = record;
  const plan = await runPlan(sources, record.issue, run);
  const { commands } = runConfig(run, sources.baseline);
  checkLockfileCommand(planManifests(plan.body), commands.update_lockfile);
  const main = await sources.contents.defaultBranch();
  // The first stage of a run that continues an earlier run's branch.
  const merge =
    run.branch !== undefined && run.pushes === 0
      ? {
          main: main.name,
          message: mergeMessage(main.name, run.branch, record.issue),
        }
      : undefined;
  const conflicts = await sources.workspace.prepare({
    branch: run.branch,
    merge,
  });
  await install(sources, commands.install);
  return {
    kind: "developer",
    plan,
    branch: run.branch,
    gateFailures: await gateFailures(sources, run.progress.pushedSha),
    conflicts,
    commands: {
      install: commands.install,
      lint: commands.lint,
      test: commands.test,
    },
    review: await openReview(sources, run),
  };
}
