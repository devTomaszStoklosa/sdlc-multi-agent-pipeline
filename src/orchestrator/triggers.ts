import { z } from "zod";
import type { RunRecord } from "../core/run-store/run-record.ts";
import type { RunEvent } from "../core/state-machine/events.ts";
import { isActive } from "../core/state-machine/states.ts";
import { authorize, type Actor } from "../github/authorize.ts";
import type { PermissionsPort } from "../github/ports.ts";
import type { GitHubEvent } from "./filter.ts";

// What an event of GitHub means for the run of an issue, after the check of
// who caused it (spec 9.4).
export type Trigger =
  | { kind: "start"; actor: Actor; label: string }
  | {
      kind: "event";
      event: RunEvent;
      update?: (run: RunRecord["run"]) => RunRecord["run"];
    }
  | { kind: "reconcile"; actor: Actor }
  | { kind: "ignore"; reason: string };

const actor = z.object({ login: z.string(), type: z.string() });

const labelEvent = z.object({
  action: z.enum(["labeled", "unlabeled"]),
  label: z.object({ name: z.string() }),
  sender: actor,
});

const commentEvent = z.object({ comment: z.object({ user: actor }) });

const gatesEvent = z.object({
  workflow_run: z.object({
    head_branch: z.string().nullable(),
    head_sha: z.string(),
    conclusion: z.string().nullable(),
  }),
});

const dispatchEvent = z.object({ sender: actor });

const ignore = (reason: string): Trigger => ({ kind: "ignore", reason });

type ActiveRun = RunRecord["run"];

async function allowed(
  who: Actor,
  action: "label" | "comment",
  permissions: PermissionsPort,
): Promise<string | undefined> {
  const result = await authorize(who, action, permissions);
  return result.allowed ? undefined : result.reason;
}

type LabelEvent = z.infer<typeof labelEvent>;

function approvalOf(event: LabelEvent, run: ActiveRun, now: Date): Trigger {
  const approval = {
    version: run.progress.planVersion,
    by: event.sender.login,
    at: now.toISOString(),
  };
  return {
    kind: "event",
    event: { type: "plan-approved", ...approval },
    // The approval counts only in awaiting-plan-approval (FR-4.5).
    update: (current) =>
      current.progress.state === "awaiting-plan-approval"
        ? { ...current, approval }
        : current,
  };
}

// Labels of an active run: `plan:approved` added and `needs-human` removed.
async function fromRunLabel(
  event: LabelEvent,
  run: ActiveRun,
  permissions: PermissionsPort,
  now: Date,
): Promise<Trigger> {
  const { labels } = run;
  const name = event.label.name;
  const added = event.action === "labeled";
  if (added && name === labels.ready) {
    return ignore(`run ${run.id} is already active (FR-4.2)`);
  }
  const isApproval = added && name === labels.plan_approved;
  const isResume = !added && name === labels.needs_human;
  if (!isApproval && !isResume) return ignore(`label ${name} changes nothing`);
  const refused = await allowed(event.sender, "label", permissions);
  if (refused !== undefined) return ignore(refused);
  if (isResume)
    return { kind: "event", event: { type: "needs-human-removed" } };
  return approvalOf(event, run, now);
}

async function fromLabel(
  payload: unknown,
  run: ActiveRun | undefined,
  permissions: PermissionsPort,
  now: Date,
): Promise<Trigger> {
  const event = labelEvent.parse(payload);
  if (run !== undefined) return fromRunLabel(event, run, permissions, now);
  if (event.action !== "labeled") return ignore("the issue has no active run");
  return { kind: "start", actor: event.sender, label: event.label.name };
}

async function fromComment(
  payload: unknown,
  run: ActiveRun | undefined,
  permissions: PermissionsPort,
): Promise<Trigger> {
  if (run?.progress.state !== "awaiting-plan-approval") {
    return ignore("comments count only while a plan awaits approval");
  }
  const event = commentEvent.parse(payload);
  const refused = await allowed(event.comment.user, "comment", permissions);
  if (refused !== undefined) return ignore(refused);
  return { kind: "event", event: { type: "plan-changes-requested" } };
}

// Only the gates of the run's branch and last push count (FR-4.12, FR-4.33).
// A cancelled or skipped gates run has no result.
function fromGates(payload: unknown, run: ActiveRun | undefined): Trigger {
  const { workflow_run: gates } = gatesEvent.parse(payload);
  if (run?.progress.state !== "gating") return ignore("the run is not gating");
  if (gates.head_branch !== run.branch)
    return ignore("the gates ran on another branch");
  if (gates.head_sha !== run.progress.pushedSha)
    return ignore("the gates ran on an earlier push");
  if (
    gates.conclusion === null ||
    ["cancelled", "skipped"].includes(gates.conclusion)
  ) {
    return ignore(`the gates ended as ${gates.conclusion ?? "unknown"}`);
  }
  const passed = gates.conclusion === "success";
  return {
    kind: "event",
    event: { type: "gates-completed", sha: gates.head_sha, passed },
  };
}

export async function triggerOf(
  event: GitHubEvent,
  record: RunRecord | undefined,
  permissions: PermissionsPort,
  now: Date,
): Promise<Trigger> {
  const run =
    record && isActive(record.run.progress.state) ? record.run : undefined;
  switch (event.name) {
    case "issues":
      return fromLabel(event.payload, run, permissions, now);
    case "issue_comment":
      return fromComment(event.payload, run, permissions);
    case "workflow_run":
      return fromGates(event.payload, run);
    case "workflow_dispatch":
      return {
        kind: "reconcile",
        actor: dispatchEvent.parse(event.payload).sender,
      };
    default:
      return ignore(`${event.name} events are not handled`);
  }
}
