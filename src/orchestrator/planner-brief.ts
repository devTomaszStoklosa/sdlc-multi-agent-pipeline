import type { BranchDiff, PlannerBrief } from "../agents/planner/brief.ts";
import { isPlanComment } from "../agents/planner/plan-comment.ts";
import type { RunRecord } from "../core/run-store/run-record.ts";
import { atLeast } from "../github/authorize.ts";
import type {
  CommentsPort,
  ContentsPort,
  IssueComment,
  PermissionsPort,
  PullRequestsPort,
} from "../github/ports.ts";
import { stopSummaryHeading } from "./stop-summary.ts";

export interface BriefSources {
  comments: CommentsPort;
  permissions: PermissionsPort;
  pulls: PullRequestsPort;
  contents: ContentsPort;
  // The pipeline's app, the author of its own comments.
  appId: number;
  repository: string;
}

type PreviousRun = RunRecord["previousRuns"][number];

function isPerson(comment: IssueComment): boolean {
  return comment.appId === undefined && !comment.authorLogin.endsWith("[bot]");
}

// Only comments of people who may comment on a run reach the model, the same
// rule as for comments that change a run (FR-4.23, SEC-8.10).
async function writers(
  comments: readonly IssueComment[],
  permissions: PermissionsPort,
): Promise<Set<string>> {
  const logins = new Set(comments.filter(isPerson).map((c) => c.authorLogin));
  const allowed = new Set<string>();
  for (const login of logins) {
    if (atLeast(await permissions.permissionOf(login), "write")) {
      allowed.add(login);
    }
  }
  return allowed;
}

function stopSummaryOf(
  own: readonly IssueComment[],
  previous: PreviousRun | undefined,
): string | undefined {
  if (previous?.state !== "stopped") return undefined;
  const heading = stopSummaryHeading(previous.id);
  return own.find((comment) => comment.body.startsWith(heading))?.body;
}

// The branch of the latest earlier pull request that is still open, which a
// new run continues (FR-4.28b).
async function branchDiffOf(
  previous: readonly PreviousRun[],
  sources: BriefSources,
): Promise<BranchDiff | undefined> {
  const pr = previous.findLast((run) => run.pr !== undefined)?.pr;
  if (pr === undefined) return undefined;
  const pull = await sources.pulls.getPull(pr);
  if (pull.state !== "open" || pull.headRepo !== sources.repository) {
    return undefined;
  }
  const main = await sources.contents.defaultBranch();
  const files = await sources.contents.compare(main.name, pull.headRef);
  return { branch: pull.headRef, base: main.name, files };
}

// What a Planner session gets besides the issue (FR-4.28b): comments, every
// earlier plan version, the stop summary and the branch diff of an earlier
// run.
export async function plannerBrief(
  sources: BriefSources,
  record: RunRecord,
): Promise<PlannerBrief> {
  const comments = await sources.comments.listComments(record.issue);
  const own = comments.filter((comment) => comment.appId === sources.appId);
  const allowed = await writers(comments, sources.permissions);
  return {
    kind: "planner",
    comments: comments
      .filter(
        (comment) => isPerson(comment) && allowed.has(comment.authorLogin),
      )
      .map((comment) => ({
        author: comment.authorLogin,
        at: comment.createdAt,
        body: comment.body,
      })),
    previousPlans: own
      .filter((comment) => isPlanComment(comment.body))
      .map((comment) => ({ at: comment.createdAt, body: comment.body })),
    stopSummary: stopSummaryOf(own, record.previousRuns.at(-1)),
    branchDiff: await branchDiffOf(record.previousRuns, sources),
  };
}
