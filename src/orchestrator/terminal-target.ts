import { z } from "zod";
import { STOP_LABEL } from "../config/schema.ts";
import type { RunRecord } from "../core/run-store/run-record.ts";
import { issueOfBranch } from "./branch.ts";
import type { GitHubEvent } from "./filter.ts";

// The run that a stop or a closed pull request ends (FR-4.28, FR-4.35). The
// first job hands it to the second, which validates it again.
export const terminalTargetSchema = z.strictObject({
  kind: z.enum(["stop", "close"]),
  issue: z.number().int().min(1),
  where: z.enum(["issue", "pr"]),
  pr: z.number().int().min(1).optional(),
  actor: z.string(),
  merged: z.boolean().optional(),
});

export type TerminalTarget = z.infer<typeof terminalTargetSchema>;

export type TargetResult =
  { ok: true; target: TerminalTarget } | { ok: false; reason: string };

const sender = z.object({ login: z.string() });

const issueLabeled = z.object({
  action: z.literal("labeled"),
  issue: z.object({ number: z.number() }),
  label: z.object({ name: z.string() }),
  sender,
});

const pullEvent = z.object({
  action: z.string(),
  label: z.object({ name: z.string() }).optional(),
  pull_request: z.object({
    number: z.number(),
    merged: z.boolean().nullable().optional(),
    head: z.object({
      ref: z.string(),
      repo: z.object({ full_name: z.string() }).nullable(),
    }),
  }),
  sender,
});

const reject = (reason: string): TargetResult => ({ ok: false, reason });

function fromPull(payload: unknown, repository: string): TargetResult {
  const event = pullEvent.parse(payload);
  const pull = event.pull_request;
  // Only pull requests of this repository's run branches (FR-4.33).
  if (pull.head.repo?.full_name !== repository) {
    return reject("the pull request comes from another repository");
  }
  const issue = issueOfBranch(pull.head.ref);
  if (issue === undefined) return reject("the branch belongs to no issue");
  const base = {
    issue,
    where: "pr" as const,
    pr: pull.number,
    actor: event.sender.login,
  };
  if (event.action === "closed") {
    return {
      ok: true,
      target: { ...base, kind: "close", merged: pull.merged === true },
    };
  }
  if (event.action === "labeled" && event.label?.name === STOP_LABEL) {
    return { ok: true, target: { ...base, kind: "stop" } };
  }
  return reject(`pull_request ${event.action} ends no run`);
}

export function resolveTarget(
  event: GitHubEvent,
  repository: string,
): TargetResult {
  if (event.name === "pull_request") return fromPull(event.payload, repository);
  if (event.name !== "issues") return reject(`${event.name} events end no run`);
  const parsed = issueLabeled.safeParse(event.payload);
  if (!parsed.success || parsed.data.label.name !== STOP_LABEL) {
    return reject(`only ${STOP_LABEL} ends a run`);
  }
  const { issue, sender: who } = parsed.data;
  return {
    ok: true,
    target: {
      kind: "stop",
      issue: issue.number,
      where: "issue",
      actor: who.login,
    },
  };
}

// Why the target's run is not the one to end, if it is not. A pull request
// ends only the run that works on it.
export function mismatch(
  record: RunRecord | undefined,
  target: TerminalTarget,
): string | undefined {
  if (record === undefined) return "the issue has no run";
  if (target.pr !== undefined && record.run.pr !== target.pr) {
    return `pull request #${String(target.pr)} is not the pull request of run ${record.run.id}`;
  }
  return undefined;
}
