import { z } from "zod";
import { isBot } from "../github/authorize.ts";
import { STOP_LABEL } from "../config/schema.ts";
import { issueOfBranch } from "./branch.ts";

export interface GitHubEvent {
  name: string;
  payload: unknown;
}

export type FilterResult =
  { proceed: true; issue: number } | { proceed: false; reason: string };

const actor = z.object({ login: z.string(), type: z.string() });

const issuesEvent = z.object({
  action: z.string(),
  issue: z.object({ number: z.number() }),
  label: z.object({ name: z.string() }).optional(),
  sender: actor,
});

const commentEvent = z.object({
  action: z.string(),
  issue: z.object({ number: z.number(), pull_request: z.unknown().optional() }),
  comment: z.object({ author_association: z.string(), user: actor }),
});

const workflowRunEvent = z.object({
  action: z.string(),
  workflow_run: z.object({
    head_branch: z.string().nullable(),
    head_repository: z.object({ full_name: z.string() }).nullable(),
  }),
});

const dispatchEvent = z.object({
  inputs: z.object({ issue: z.string().regex(/^[1-9]\d*$/) }),
});

// Associations of the repository's collaborators. The exact permission check
// is in the decide job (plan 3.5).
const COLLABORATORS = ["OWNER", "MEMBER", "COLLABORATOR"];

const drop = (reason: string): FilterResult => ({ proceed: false, reason });

function filterIssues(payload: unknown): FilterResult {
  const event = issuesEvent.parse(payload);
  if (event.action !== "labeled" && event.action !== "unlabeled") {
    return drop(`issues ${event.action} is not handled`);
  }
  if (isBot(event.sender)) return drop(`${event.sender.login} is a bot`);
  // stop.yml handles agent:stop, outside the run's queue (plan 2.2), and
  // removing it starts nothing (FR-4.28b).
  if (event.label?.name === STOP_LABEL) {
    return drop(`${STOP_LABEL} is handled by the stop workflow`);
  }
  return { proceed: true, issue: event.issue.number };
}

function filterComment(payload: unknown): FilterResult {
  const event = commentEvent.parse(payload);
  if (event.action !== "created") return drop("only new comments count");
  const author = event.comment.user;
  if (isBot(author)) return drop(`${author.login} is a bot`);
  if (event.issue.pull_request !== undefined) {
    return drop("comments on pull requests come after the MVP");
  }
  if (!COLLABORATORS.includes(event.comment.author_association)) {
    return drop(`${author.login} is not a collaborator`);
  }
  return { proceed: true, issue: event.issue.number };
}

// Gate results count only for branches of this repository (FR-4.33).
function filterWorkflowRun(payload: unknown, repository: string): FilterResult {
  const event = workflowRunEvent.parse(payload);
  if (event.action !== "completed") return drop("the gates have not completed");
  const run = event.workflow_run;
  if (run.head_repository?.full_name !== repository) {
    return drop("the gates ran on a branch of another repository");
  }
  const issue = issueOfBranch(run.head_branch ?? "");
  if (issue === undefined) return drop("the branch belongs to no issue");
  return { proceed: true, issue };
}

function filterDispatch(payload: unknown): FilterResult {
  const parsed = dispatchEvent.safeParse(payload);
  if (!parsed.success) return drop("the dispatch has no valid issue number");
  return { proceed: true, issue: Number(parsed.data.inputs.issue) };
}

// The filter job, outside the concurrency group and without any token or
// model. Events from bots and strangers end here, so they never wait in the
// run's queue or cancel the events waiting there (plan 4, SEC-8.6, SEC-8.7).
export function filterEvent(
  event: GitHubEvent,
  repository: string,
): FilterResult {
  switch (event.name) {
    case "issues":
      return filterIssues(event.payload);
    case "issue_comment":
      return filterComment(event.payload);
    case "workflow_run":
      return filterWorkflowRun(event.payload, repository);
    case "workflow_dispatch":
      return filterDispatch(event.payload);
    default:
      return drop(`${event.name} events are not handled`);
  }
}
