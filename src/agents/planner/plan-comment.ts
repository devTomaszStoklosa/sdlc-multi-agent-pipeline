import { parseDocument, stringify } from "yaml";
import { z } from "zod";
import { redactText } from "../../hooks/redact.ts";
import type { Classification, Reason } from "./high-impact.ts";
import { CHANGE_KINDS, isRepositoryPath, type Plan } from "./plan.ts";

const INFO = "yaml sdlc-plan";
const BLOCK = /^(`{3,})yaml sdlc-plan\n([\s\S]*?)\n\1[ \t]*$/m;
const HEADING = /^### (?:Plan|Aktualizacja planu), wersja \d+/;

export interface PlanCommentFacts {
  runId: string;
  version: number;
  plan: Plan;
  classification: Classification;
  approvalLabel: string;
}

// The machine-readable part of a plan comment (FR-4.3): the files of the
// plan, which the scope gate reads in P6.
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

function block(facts: PlanCommentFacts): string {
  const yaml = stringify(
    {
      run: facts.runId,
      version: facts.version,
      high_impact: facts.classification.highImpact,
      files: facts.plan.files.map((file) => ({
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

function reasonLine(reason: Reason): string {
  const source = reason.source === "rule" ? "reguła" : "ocena Plannera";
  return `- ${source}: ${safeText(reason.text)}`;
}

function classification(facts: PlanCommentFacts): string[] {
  const { highImpact, reasons } = facts.classification;
  const head = highImpact
    ? `**Klasyfikacja:** high-impact. Przebieg czeka na akceptację tej wersji etykietą \`${facts.approvalLabel}\`. Prośbę o zmiany w planie napisz w komentarzu.`
    : "**Klasyfikacja:** zwykła zmiana. Przebieg toczy się dalej bez czekania na akceptację.";
  return [head, "", ...reasons.map(reasonLine)];
}

// The plan comment, built by the job from the validated result, so every
// version has the elements of FR-4.3 and the same machine-readable block.
export function planComment(facts: PlanCommentFacts): string {
  const { plan } = facts;
  return [
    `### Plan, wersja ${String(facts.version)} (przebieg ${facts.runId})`,
    "",
    ...classification(facts),
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
    block(facts),
    "",
    "#### Testy",
    "",
    safeText(plan.testing),
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
