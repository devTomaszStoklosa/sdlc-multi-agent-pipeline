import { parseDocument, stringify } from "yaml";
import { z } from "zod";
import type { IssueComment } from "../../github/ports.ts";
import { redactText } from "../../hooks/redact.ts";
import type { Classification, Reason } from "./high-impact.ts";
import {
  CHANGE_KINDS,
  isRepositoryPath,
  type Plan,
  type PlanFile,
} from "./plan.ts";

const INFO = "yaml sdlc-plan";
const BLOCK = /^(`{3,})yaml sdlc-plan\n([\s\S]*?)\n\1[ \t]*$/m;
const HEADING = /^### (?:Plan|Aktualizacja planu), wersja \d+/;
const RUN_NUMBER = /-(\d+)$/;

export interface PlanCommentFacts {
  runId: string;
  version: number;
  plan: Plan;
  classification: Classification;
  approvalLabel: string;
}

// A Developer's update of the plan (FR-4.11): the reason, the files it adds
// or changes, and the whole new file list.
export interface PlanUpdateFacts {
  runId: string;
  version: number;
  reason: string;
  changed: readonly PlanFile[];
  files: readonly PlanFile[];
  classification: Classification;
  approvalLabel: string;
}

// The machine-readable part of a plan comment (FR-4.3): the files of the
// plan, which the scope gate reads (QG-7.9).
const blockSchema = z.strictObject({
  run: z.string().min(1),
  version: z.number().int().min(1),
  high_impact: z.boolean(),
  files: z
    .array(
      z.strictObject({
        path: z.string().refine(isRepositoryPath),
        change: z.enum(CHANGE_KINDS),
        why: z.string(),
      }),
    )
    .min(1),
});

export type PlanBlock = z.infer<typeof blockSchema>;

// Text from a session, made safe for a comment: secrets redacted (SEC-9.10),
// no HTML comment that could pass for a marker of the pipeline, and no
// mentions that notify people.
export function safeText(text: string): string {
  return redactText(text)
    .value.replaceAll("<!--", "&lt;!--")
    .replace(/@(?=[A-Za-z0-9-])/g, "@​");
}

function cell(text: string): string {
  return safeText(text).replaceAll("|", "\\|");
}

// A fence longer than any run of backticks in the content.
function fence(content: string): string {
  const runs = [...content.matchAll(/`+/g)].map((match) => match[0].length);
  return "`".repeat(Math.max(2, ...runs) + 1);
}

function block(
  facts: Pick<PlanCommentFacts, "runId" | "version" | "classification">,
  files: readonly PlanFile[],
): string {
  const yaml = stringify(
    {
      run: facts.runId,
      version: facts.version,
      high_impact: facts.classification.highImpact,
      files: files.map((file) => ({
        path: file.path,
        change: file.change,
        why: redactText(file.why).value,
      })),
    },
    { lineWidth: 0 },
  );
  const marks = fence(yaml);
  return `${marks}${INFO}\n${yaml}${marks}`;
}

// The agent whose own assessment is a reason, in the genitive.
type Assessor = "Plannera" | "Developera";

function reasonLine(reason: Reason, assessor: Assessor): string {
  const source = reason.source === "rule" ? "reguła" : `ocena ${assessor}`;
  return `- ${source}: ${safeText(reason.text)}`;
}

function classification(
  facts: Pick<PlanCommentFacts, "classification" | "approvalLabel">,
  assessor: Assessor,
): string[] {
  const { highImpact, reasons } = facts.classification;
  const head = highImpact
    ? `**Klasyfikacja:** high-impact. Przebieg czeka na akceptację tej wersji etykietą \`${facts.approvalLabel}\`. Prośbę o zmiany w planie napisz w komentarzu.`
    : "**Klasyfikacja:** zwykła zmiana. Przebieg toczy się dalej bez czekania na akceptację.";
  return [head, "", ...reasons.map((reason) => reasonLine(reason, assessor))];
}

// The plan comment, built by the job from the validated result, so every
// version has the elements of FR-4.3 and the same machine-readable block.
export function planComment(facts: PlanCommentFacts): string {
  const { plan } = facts;
  return [
    `### Plan, wersja ${String(facts.version)} (przebieg ${facts.runId})`,
    "",
    ...classification(facts, "Plannera"),
    "",
    "#### Podsumowanie",
    "",
    safeText(plan.summary),
    "",
    "#### Podejście",
    "",
    safeText(plan.approach),
    "",
    "#### Kryteria akceptacji",
    "",
    "| Kryterium | Jak zostanie spełnione |",
    "|---|---|",
    ...plan.acceptance.map(
      (entry) => `| ${cell(entry.criterion)} | ${cell(entry.how)} |`,
    ),
    "",
    "#### Pliki",
    "",
    block(facts, plan.files),
    "",
    "#### Testy",
    "",
    safeText(plan.testing),
    "",
  ].join("\n");
}

// A new plan version with the Developer's reason (FR-4.11). The other
// elements of FR-4.3 stay those of the version it updates.
export function planUpdateComment(facts: PlanUpdateFacts): string {
  return [
    `### Aktualizacja planu, wersja ${String(facts.version)} (przebieg ${facts.runId})`,
    "",
    ...classification(facts, "Developera"),
    "",
    "#### Powód",
    "",
    safeText(facts.reason),
    "",
    "#### Nowe albo zmienione pliki",
    "",
    "| Plik | Zmiana | Uzasadnienie |",
    "|---|---|---|",
    ...facts.changed.map(
      (file) => `| \`${file.path}\` | ${file.change} | ${cell(file.why)} |`,
    ),
    "",
    "#### Wszystkie pliki planu",
    "",
    block(facts, facts.files),
    "",
  ].join("\n");
}

// A version of the plan or of its update. Only comments of the pipeline's
// app count; the caller checks the author.
export function isPlanComment(body: string): boolean {
  return HEADING.test(body);
}

// The `sdlc-plan` block of a plan comment, if it has a valid one.
export function parsePlanBlock(body: string): PlanBlock | undefined {
  const match = BLOCK.exec(body.replaceAll("\r\n", "\n"));
  const text = match?.[2];
  if (text === undefined) return undefined;
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length > 0) return undefined;
  const parsed = blockSchema.safeParse(document.toJS());
  return parsed.success ? parsed.data : undefined;
}

export interface PlanEntry {
  block: PlanBlock;
  body: string;
  url: string;
}

// Every plan version that the pipeline's app posted on an issue.
export function planEntries(
  comments: readonly IssueComment[],
  appId: number,
): PlanEntry[] {
  return comments.flatMap((comment) => {
    if (comment.appId !== appId || !isPlanComment(comment.body)) return [];
    const parsed = parsePlanBlock(comment.body);
    return parsed === undefined
      ? []
      : [{ block: parsed, body: comment.body, url: comment.url }];
  });
}

export function planOf(
  entries: readonly PlanEntry[],
  runId: string,
  version: number,
): PlanEntry | undefined {
  return entries.findLast(
    (entry) => entry.block.run === runId && entry.block.version === version,
  );
}

function runNumber(runId: string): number {
  return Number(RUN_NUMBER.exec(runId)?.[1] ?? "0");
}

// The newest plan of the newest run of the issue.
export function latestPlan(
  entries: readonly PlanEntry[],
): PlanEntry | undefined {
  const rank = (entry: PlanEntry) => [
    runNumber(entry.block.run),
    entry.block.version,
  ];
  return entries.reduce<PlanEntry | undefined>((best, entry) => {
    if (best === undefined) return entry;
    const [run = 0, version = 0] = rank(entry);
    const [bestRun = 0, bestVersion = 0] = rank(best);
    const newer = run > bestRun || (run === bestRun && version >= bestVersion);
    return newer ? entry : best;
  }, undefined);
}
