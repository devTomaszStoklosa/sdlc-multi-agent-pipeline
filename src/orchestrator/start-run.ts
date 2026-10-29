import { parseDocument } from "yaml";
import { z } from "zod";
import { STOP_LABEL } from "../config/schema.ts";
import { validateRepoConfig } from "../config/validate.ts";
import {
  newRunRecord,
  type RunLabels,
  type RunRecord,
} from "../core/run-store/run-record.ts";
import { isActive } from "../core/state-machine/states.ts";
import { authorize, type Actor } from "../github/authorize.ts";
import type { PullRequestInfo } from "../github/ports.ts";
import { applyChange, type Applied } from "./apply.ts";
import { issueOfBranch } from "./branch.ts";
import { guardFor, type JobContext } from "./context.ts";
import { configInvalid, queued, readyRefusedStopped } from "./messages.ts";

export const CONFIG_PATH = ".sdlc-agents.yml";
const DEFAULT_LABELS: RunLabels = {
  ready: "agent:ready",
  needs_human: "needs-human",
  plan_approved: "plan:approved",
};

type MainConfig =
  | { valid: true; sha: string; text: string; labels: RunLabels }
  | { valid: false; sha: string; readyLabel: string; errors: string[] };

const readyLabelSchema = z.object({ labels: z.object({ ready: z.string() }) });

// The label names of an invalid configuration, as far as they can be read,
// so the refusal goes to the label a person actually added.
function readyLabelOf(text: string): string {
  const parsed = readyLabelSchema.safeParse(parseDocument(text).toJS());
  return parsed.success ? parsed.data.labels.ready : DEFAULT_LABELS.ready;
}

// The configuration of a new run: .sdlc-agents.yml on the main branch at the
// start of the run (FR-10.5), validated against the baseline (FR-10.1).
async function mainConfig(context: JobContext): Promise<MainConfig> {
  const main = await context.app.contents.defaultBranch();
  const text = await context.app.contents.readFile(CONFIG_PATH, main.sha);
  if (text === undefined) {
    const errors = [`${CONFIG_PATH} is missing`];
    return {
      valid: false,
      sha: main.sha,
      readyLabel: DEFAULT_LABELS.ready,
      errors,
    };
  }
  const result = validateRepoConfig(text, context.baseline);
  if (!result.ok) {
    const readyLabel = readyLabelOf(text);
    return { valid: false, sha: main.sha, readyLabel, errors: result.errors };
  }
  return { valid: true, sha: main.sha, text, labels: result.config.labels };
}

// The open pull requests of the issue: the earlier run's and any of a run
// branch of this repository.
async function openPulls(
  context: JobContext,
  issue: number,
  previous?: RunRecord,
) {
  const pulls = (await context.read.pulls.listOpenPulls()).filter(
    (pull) =>
      pull.headRepo === context.repository &&
      issueOfBranch(pull.headRef) === issue,
  );
  const earlier = previous?.run.pr;
  return { pulls, earlier: pulls.find((pull) => pull.number === earlier) };
}

// A run may start when no other run is active outside the queue and no
// queued run of another issue started earlier (plan 1.2, one run at a time).
export async function blockingIssue(
  context: JobContext,
  record: RunRecord,
): Promise<number | undefined> {
  const candidates = await context.read.issues.listOpenIssuesWithLabel(
    record.run.labels.ready,
  );
  for (const issue of candidates) {
    if (issue === record.issue) continue;
    const other = (await context.store.read(issue))?.record.run;
    if (!other || !isActive(other.progress.state)) continue;
    if (other.progress.state !== "queued") return issue;
    const earlier =
      other.startedAt < record.run.startedAt ||
      (other.startedAt === record.run.startedAt && issue < record.issue);
    if (earlier) return issue;
  }
  return undefined;
}

export async function admit(
  context: JobContext,
  record: RunRecord,
  announce: boolean,
): Promise<Applied | undefined> {
  const blocking = await blockingIssue(context, record);
  if (blocking === undefined) {
    return applyChange(context, record.issue, {
      event: { type: "capacity-available" },
    });
  }
  if (announce) {
    await guardFor(context, record.issue, record.run.id).ensure(
      "queue comment",
    );
    await context.app.comments.createComment(
      record.issue,
      queued(record.run.id, blocking),
    );
  }
  return undefined;
}

async function refuse(
  context: JobContext,
  issue: number,
  label: string,
  comment: string,
): Promise<undefined> {
  await context.app.issues.removeLabel(issue, label);
  await context.app.comments.createComment(issue, comment);
  return undefined;
}

interface NewRunParts {
  actor: Actor;
  config: Extract<MainConfig, { valid: true }>;
  previous: RunRecord | undefined;
  pull: PullRequestInfo | undefined;
}

// The new run continues the open pull request of the earlier run (FR-4.28b).
async function createRun(
  context: JobContext,
  issue: number,
  parts: NewRunParts,
): Promise<RunRecord> {
  const { actor, config, previous, pull } = parts;
  const fresh = newRunRecord(
    {
      issue,
      startedBy: actor.login,
      config: { sha: config.sha, text: config.text },
      labels: config.labels,
      workflowRunId: context.workflowRunId,
      now: context.now(),
    },
    previous,
  );
  const record: RunRecord = pull
    ? { ...fresh, run: { ...fresh.run, branch: pull.headRef, pr: pull.number } }
    : fresh;
  const written = await context.store.write(record, previous?.revision);
  if (!written.ok) {
    throw new Error(`The run state of issue #${String(issue)} changed.`);
  }
  return written.stored.record;
}

// A new run after `agent:ready` (FR-4.1). An issue or open pull request with
// `agent:stop` refuses it (FR-4.28b), and so does an invalid configuration
// (FR-10.1). A new run continues the open pull request of the earlier run.
export async function startRun(
  context: JobContext,
  issue: number,
  start: { actor: Actor; label: string },
): Promise<Applied | undefined> {
  const config = await mainConfig(context);
  const readyLabel = config.valid ? config.labels.ready : config.readyLabel;
  if (start.label !== readyLabel) return undefined;
  if (
    !(await authorize(start.actor, "label", context.app.permissions)).allowed
  ) {
    return undefined;
  }
  const stored = await context.store.read(issue);
  const previous = stored?.record;
  const { pulls, earlier } = await openPulls(context, issue, previous);
  const info = await context.read.issues.getIssue(issue);
  const stopped = [info, ...pulls].some((item) =>
    item.labels.includes(STOP_LABEL),
  );
  if (stopped)
    return refuse(context, issue, readyLabel, readyRefusedStopped(readyLabel));
  if (!config.valid) {
    return refuse(
      context,
      issue,
      readyLabel,
      configInvalid(readyLabel, config.sha, config.errors),
    );
  }
  const record = await createRun(context, issue, {
    actor: start.actor,
    config,
    previous,
    pull: earlier,
  });
  return admit(context, record, true);
}
