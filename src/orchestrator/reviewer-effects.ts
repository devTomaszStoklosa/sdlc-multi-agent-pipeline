import { briefOf } from "../agents/brief.ts";
import type { ReviewerBrief } from "../agents/reviewer/brief.ts";
import { anchorOf, findingId } from "../agents/reviewer/finding-id.ts";
import {
  openBlocking,
  reviewBody,
  where,
  type ReviewedFinding,
  type ReviewRecord,
} from "../agents/reviewer/review-comment.ts";
import type { Review, ReviewFinding } from "../agents/reviewer/review.ts";
import { completeAgentReview } from "./agent-review.ts";
import type { EffectScope } from "./role-effects.ts";
import type { RoleOutcome } from "./role-output.ts";
import { placeFindings } from "./review-placement.ts";

type VerdictOutcome = Extract<RoleOutcome, { kind: "verdict" }>;

interface ReviewerScope extends EffectScope {
  brief: ReviewerBrief;
  pr: number;
}

function reviewerScope(scope: EffectScope): ReviewerScope {
  const brief = briefOf(scope.brief, "reviewer");
  const { pr } = scope.run;
  if (brief === undefined || pr === undefined) {
    throw new Error("A Reviewer job needs its brief and pull request.");
  }
  return { ...scope, brief, pr };
}

// The identifier of each finding from its rule, file and the text of its line
// in the reviewed commit (FR-4.14). Findings with the same identifier are one
// finding.
async function identify(
  scope: ReviewerScope,
  findings: readonly ReviewFinding[],
): Promise<ReviewedFinding[]> {
  const files = new Map<string, string | undefined>();
  const identified = new Map<string, ReviewedFinding>();
  for (const finding of findings) {
    if (!files.has(finding.path)) {
      const text = await scope.context.app.contents.readFile(
        finding.path,
        scope.brief.sha,
      );
      files.set(finding.path, text);
    }
    const anchor = anchorOf(files.get(finding.path), finding.line);
    const id = findingId(finding.rule, finding.path, anchor);
    if (!identified.has(id)) identified.set(id, { id, ...finding });
  }
  return [...identified.values()];
}

// The state of each open finding of the previous round (FR-4.16). One the
// session left out stays open: a human looks at it rather than nobody.
function earlierStates(
  brief: ReviewerBrief,
  review: Review,
): ReviewRecord["earlier"] {
  return brief.earlier.map(({ finding }) => {
    const state = review.earlier.find((entry) => entry.id === finding.id);
    return {
      id: finding.id,
      resolved: state?.resolved ?? false,
      note: state?.note ?? "Reviewer nie ocenił znaleziska.",
    };
  });
}

// The record of the round. Any open blocking finding requests changes, so
// `approve` means no open blocking finding (FR-4.17).
function recordOf(
  scope: ReviewerScope,
  findings: ReviewedFinding[],
  earlier: ReviewRecord["earlier"],
): ReviewRecord {
  const record: ReviewRecord = {
    run: scope.run.id,
    round: scope.run.progress.reviewRound,
    sha: scope.brief.sha,
    verdict: "approve",
    findings,
    earlier,
    gates: scope.brief.gates,
  };
  const open = openBlocking(record).length > 0;
  return { ...record, verdict: open ? "changes_requested" : "approve" };
}

function openSummary(
  record: ReviewRecord,
  brief: ReviewerBrief,
): VerdictOutcome["review"]["open"] {
  const known = new Map<string, ReviewedFinding>(
    [...brief.earlier.map((entry) => entry.finding), ...record.findings].map(
      (finding) => [finding.id, finding],
    ),
  );
  return openBlocking(record).flatMap((id) => {
    const finding = known.get(id);
    return finding ? [{ id, rule: finding.rule, place: where(finding) }] : [];
  });
}

function checkSummary(record: ReviewRecord, url: string): string {
  const blocking = record.findings.filter((f) => f.blocking).length;
  const reopened = record.earlier.filter((e) => !e.resolved).length;
  return `Runda ${String(record.round)} przebiegu ${record.run}: nowe znaleziska blokujące ${String(blocking)}, nieblokujące ${String(record.findings.length - blocking)}, nierozwiązane z poprzedniej rundy ${String(reopened)}. [Review](${url}).`;
}

// The side effects of a review (FR-4.14): one review of the pull request that
// only comments, then the verdict as the `agent-review` check run, each after
// the check of FR-4.28c.
export async function reviewerEffects(
  given: EffectScope,
  review: Review,
): Promise<RoleOutcome> {
  const scope = reviewerScope(given);
  const { context, brief, pr } = scope;
  const findings = await identify(scope, review.findings);
  const record = recordOf(scope, findings, earlierStates(brief, review));
  const placement = placeFindings(findings, brief.diff);
  const posted = await scope.guard.perform("review", () =>
    context.app.reviews.commentReview(pr, {
      commitId: brief.sha,
      body: reviewBody(record, placement.detached),
      comments: placement.comments,
    }),
  );
  const approved = record.verdict === "approve";
  await completeAgentReview(scope, approved ? "success" : "failure", {
    title: record.verdict,
    summary: checkSummary(record, posted.url),
    detailsUrl: posted.url,
  });
  await context.log.append({
    time: context.now().toISOString(),
    type: "review",
    issue: scope.issue.number,
    run: scope.run.id,
    pr,
    agent: "reviewer",
    workflow_run: context.workflowRunId,
    result: record.verdict,
    round: record.round,
    details: { rules: findings.map((finding) => finding.rule) },
  });
  return {
    kind: "verdict",
    verdict: record.verdict,
    blockingFindings: openBlocking(record),
    review: { url: posted.url, open: openSummary(record, brief) },
  };
}
