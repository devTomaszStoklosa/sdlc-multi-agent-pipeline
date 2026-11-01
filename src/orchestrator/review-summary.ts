import { safeText } from "../agents/planner/plan-comment.ts";
import {
  where,
  type PostedReview,
  type ReviewedFinding,
} from "../agents/reviewer/review-comment.ts";
import type { RunPlan } from "./run-plan.ts";

const START = "<!-- sdlc-review-summary -->";
const END = "<!-- /sdlc-review-summary -->";

function label(finding: ReviewedFinding): string {
  return `\`${finding.id}\` (\`${finding.rule}\`, \`${where(finding)}\`)`;
}

function gatesLine(last: PostedReview | undefined): string {
  if (last === undefined) return "- **Bramki:** brak review z wynikami.";
  const { gates, sha } = last.record;
  const jobs = gates.jobs.map((job) => `${job.name} (${job.conclusion})`);
  const link = gates.url === undefined ? "" : ` ([run](${gates.url}))`;
  const list = jobs.length === 0 ? "" : `: ${jobs.join(", ")}`;
  return `- **Bramki:** zaliczone na \`${sha.slice(0, 7)}\`${link}${list}.`;
}

// One line per round: its verdict, its blocking findings and the earlier
// findings it found resolved (FR-4.20).
function roundLine({ record, url }: PostedReview): string {
  const blocking = record.findings.filter((f) => f.blocking).map(label);
  const resolved = record.earlier
    .filter((entry) => entry.resolved)
    .map((entry) => `\`${entry.id}\``);
  const parts = [
    `\`${record.verdict}\``,
    ...(blocking.length === 0 ? [] : [`blokujące: ${blocking.join(", ")}`]),
    ...(resolved.length === 0 ? [] : [`rozwiązane: ${resolved.join(", ")}`]),
  ];
  return `- **Runda ${String(record.round)}** ([review](${url})): ${parts.join("; ")}.`;
}

// The non-blocking findings of the approving review, which stay open
// (FR-4.17).
function openNonBlocking(last: PostedReview | undefined): string[] {
  const findings = (last?.record.findings ?? []).filter((f) => !f.blocking);
  if (findings.length === 0) return ["Brak."];
  return findings.map(
    (finding) =>
      `- ${label(finding)}: ${safeText(finding.description)} Powód, dla którego nie blokuje: ${safeText(finding.nonBlockingReason ?? "")}`,
  );
}

// The part of the pull request body that the final review request adds
// (FR-4.20): the plan, the gate results, every review round with the
// findings it resolved and the open non-blocking findings. The rest of the
// body keeps what changed and why, the issue and the issues out of scope.
export function reviewSummary(
  plan: RunPlan,
  reviews: readonly PostedReview[],
): string {
  const last = reviews.at(-1);
  return [
    START,
    "## Przed finalną akceptacją",
    "",
    `- **Plan:** [wersja ${String(plan.version)}](${plan.url})`,
    gatesLine(last),
    "- **Środowisko dev:** brak w MVP (wdrożenie na dev od F3).",
    "",
    "### Rundy review",
    "",
    ...reviews.map(roundLine),
    "",
    "### Otwarte znaleziska nieblokujące",
    "",
    ...openNonBlocking(last),
    END,
  ].join("\n");
}

// The body with the summary in place of an earlier one.
export function withReviewSummary(body: string, summary: string): string {
  const start = body.indexOf(START);
  const end = body.indexOf(END);
  if (start === -1 || end < start) return `${body.trimEnd()}\n\n${summary}`;
  return `${body.slice(0, start)}${summary}${body.slice(end + END.length)}`;
}
