import { z } from "zod";
import type { PullReview, PullReviewComment } from "../../github/ports.ts";
import { redactText } from "../../hooks/redact.ts";
import { safeText } from "../planner/plan-comment.ts";
import { REVIEW_RULES } from "./review.ts";

const BLOCK = /<!-- sdlc-review\n(.*)\n-->/;
const FINDING_MARK = /<!-- sdlc-finding (F-[0-9a-f]+) -->/;
const REPLY_MARK = /<!-- sdlc-reply (F-[0-9a-f]+) -->/;

export const VERDICTS = ["approve", "changes_requested"] as const;
export type Verdict = (typeof VERDICTS)[number];

const findingSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().min(0),
  rule: z.enum(REVIEW_RULES),
  blocking: z.boolean(),
  nonBlockingReason: z.string().optional(),
  description: z.string(),
  suggestion: z.string(),
});

const gatesSchema = z.object({
  url: z.string().optional(),
  jobs: z.array(z.object({ name: z.string(), conclusion: z.string() })),
});

// The machine-readable part of a review: the round, the reviewed commit, the
// verdict, the findings with their identifiers, the state of the earlier
// findings (FR-4.16) and the gate results that the review saw. The Developer,
// the next round and the pull request body read it (FR-4.15, FR-4.20).
const recordSchema = z.object({
  run: z.string().min(1),
  round: z.number().int().min(1),
  sha: z.string().min(1),
  verdict: z.enum(VERDICTS),
  findings: z.array(findingSchema),
  earlier: z.array(
    z.object({ id: z.string(), resolved: z.boolean(), note: z.string() }),
  ),
  gates: gatesSchema,
});

export type ReviewedFinding = z.infer<typeof findingSchema>;
export type ReviewRecord = z.infer<typeof recordSchema>;
export type GateResults = z.infer<typeof gatesSchema>;

export interface PostedReview {
  record: ReviewRecord;
  url: string;
}

// The blocking findings a review leaves open: its own and the earlier ones it
// found unresolved.
export function openBlocking(record: ReviewRecord): string[] {
  const own = record.findings.filter((f) => f.blocking).map((f) => f.id);
  const earlier = record.earlier.filter((e) => !e.resolved).map((e) => e.id);
  return [...new Set([...own, ...earlier])];
}

function severity(finding: ReviewedFinding): string {
  return finding.blocking
    ? "blokujące"
    : `nieblokujące (${safeText(finding.nonBlockingReason ?? "")})`;
}

export function where(finding: Pick<ReviewedFinding, "path" | "line">) {
  return finding.line > 0
    ? `${finding.path}:${String(finding.line)}`
    : finding.path;
}

// The comment of one finding (FR-4.14), with the marker that the Developer's
// reply finds it by.
export function findingComment(finding: ReviewedFinding): string {
  return [
    `**${finding.id}** · ${severity(finding)} · reguła \`${finding.rule}\``,
    "",
    safeText(finding.description),
    "",
    `**Sugestia:** ${safeText(finding.suggestion)}`,
    "",
    `<!-- sdlc-finding ${finding.id} -->`,
  ].join("\n");
}

// The record as a hidden block. It holds no `--`, so text from a session
// cannot end the HTML comment early.
function hiddenBlock(record: ReviewRecord): string {
  const redacted: ReviewRecord = {
    ...record,
    findings: record.findings.map((finding) => ({
      ...finding,
      description: redactText(finding.description).value,
      suggestion: redactText(finding.suggestion).value,
      nonBlockingReason:
        finding.nonBlockingReason &&
        redactText(finding.nonBlockingReason).value,
    })),
    earlier: record.earlier.map((entry) => ({
      ...entry,
      note: redactText(entry.note).value,
    })),
  };
  const json = JSON.stringify(redacted).replaceAll("--", "-\\u002d");
  return `<!-- sdlc-review\n${json}\n-->`;
}

function findingLine(finding: ReviewedFinding, detached: boolean): string[] {
  const head = `- **${finding.id}** · ${severity(finding)} · \`${finding.rule}\` · \`${where(finding)}\``;
  if (!detached) return [head];
  return [
    head,
    `  ${safeText(finding.description)}`,
    `  **Sugestia:** ${safeText(finding.suggestion)}`,
  ];
}

// The body of a review. Findings without a comment of their own, because the
// diff does not show their file, carry their description here.
export function reviewBody(
  record: ReviewRecord,
  detached: ReadonlySet<string>,
): string {
  const blocking = record.findings.filter((f) => f.blocking).length;
  const earlier = record.earlier.map(
    (entry) =>
      `- **${entry.id}**: ${entry.resolved ? "rozwiązane" : "nierozwiązane"}. ${safeText(entry.note)}`,
  );
  return [
    `### Review, runda ${String(record.round)} (przebieg ${record.run}): \`${record.verdict}\``,
    "",
    `Commit \`${record.sha.slice(0, 7)}\`. Znaleziska blokujące: ${String(blocking)}, nieblokujące: ${String(record.findings.length - blocking)}. Werdykt wynika ze znalezisk, a review agenta nie liczy się do approvalu (FR-5.2).`,
    ...(record.findings.length === 0
      ? []
      : [
          "",
          "#### Znaleziska",
          "",
          ...record.findings.flatMap((f) => findingLine(f, detached.has(f.id))),
        ]),
    ...(earlier.length === 0
      ? []
      : ["", "#### Znaleziska z poprzedniej rundy", "", ...earlier]),
    "",
    hiddenBlock(record),
  ].join("\n");
}

export function parseReviewRecord(body: string): ReviewRecord | undefined {
  const text = BLOCK.exec(body.replaceAll("\r\n", "\n"))?.[1];
  if (text === undefined) return undefined;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// The reviews of a run, oldest first. Only reviews of the pipeline's app
// count: its bot's login cannot belong to anyone else.
export function runReviews(
  reviews: readonly PullReview[],
  appLogin: string,
  runId: string,
): PostedReview[] {
  return reviews.flatMap((review) => {
    if (review.authorLogin !== appLogin) return [];
    const record = parseReviewRecord(review.body);
    return record?.run === runId ? [{ record, url: review.url }] : [];
  });
}

// The finding of every identifier in the reviews, as first reported.
export function findingsById(
  reviews: readonly PostedReview[],
): Map<string, ReviewedFinding> {
  const found = new Map<string, ReviewedFinding>();
  for (const { record } of reviews) {
    for (const finding of record.findings) {
      if (!found.has(finding.id)) found.set(finding.id, finding);
    }
  }
  return found;
}

export function replyComment(id: string, reply: string): string {
  return `**Odpowiedź Developera:** ${safeText(reply)}\n\n<!-- sdlc-reply ${id} -->`;
}

// The comment of the pipeline's app that starts the thread of each finding,
// the latest one when a finding was commented more than once.
export function findingThreads(
  comments: readonly PullReviewComment[],
  appLogin: string,
): Map<string, number> {
  const threads = new Map<string, number>();
  for (const comment of comments) {
    const id = FINDING_MARK.exec(comment.body)?.[1];
    const starts = comment.inReplyTo === undefined;
    if (id !== undefined && starts && comment.authorLogin === appLogin) {
      threads.set(id, comment.id);
    }
  }
  return threads;
}

// The Developer's replies to each finding (FR-4.15), from comments of the
// pipeline's app: in the finding's thread, or on the pull request when the
// finding has no thread. The caller checks the author.
export function developerReplies(
  bodies: readonly string[],
): Map<string, string[]> {
  const replies = new Map<string, string[]>();
  for (const body of bodies) {
    const id = REPLY_MARK.exec(body)?.[1];
    if (id === undefined) continue;
    const text = body.replace(REPLY_MARK, "").trim();
    replies.set(id, [...(replies.get(id) ?? []), text]);
  }
  return replies;
}
