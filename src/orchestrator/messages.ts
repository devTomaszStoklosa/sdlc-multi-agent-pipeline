import { STOP_LABEL } from "../config/schema.ts";
import type { EscalationReason } from "../core/state-machine/events.ts";
import type { Run } from "../core/run-store/run-record.ts";

// Comments that the pipeline writes for people, in the language of the
// demo repository. None of them comes from a model (FR-5.6).

export function readyRefusedStopped(readyLabel: string): string {
  return `Przebieg nie wystartował, bo issue albo jego otwarty PR ma etykietę \`${STOP_LABEL}\`. Zdjąłem \`${readyLabel}\`. Zdejmij najpierw \`${STOP_LABEL}\`, a potem dodaj \`${readyLabel}\` ponownie (FR-4.28b).`;
}

export function configInvalid(
  readyLabel: string,
  sha: string,
  errors: readonly string[],
): string {
  return [
    `Przebieg nie wystartował, bo \`.sdlc-agents.yml\` na \`main\` (${sha.slice(0, 7)}) jest niepoprawny (FR-10.1). Zdjąłem \`${readyLabel}\`. Po poprawce dodaj etykietę ponownie.`,
    "",
    ...errors.map((error) => `- ${error}`),
  ].join("\n");
}

export function queued(runId: string, busyIssue: number): string {
  return `Przebieg ${runId} czeka w kolejce, bo w repozytorium trwa przebieg issue #${String(busyIssue)} (w MVP działa jeden przebieg naraz). Po jego zakończeniu uruchom ręcznie workflow Orchestrate z numerem tego issue.`;
}

function reasonText(reason: EscalationReason): string {
  switch (reason.kind) {
    case "review-rounds":
      return `osiągnięto limit rund review (${String(reason.rounds)})`;
    case "repeated-finding":
      return `to samo znalezisko blokujące zgłoszono drugi raz: ${reason.findings.join(", ")}`;
    case "stage-failed":
      return reason.failure === "usage-limit"
        ? `osiągnięto limit planu Claude Pro, który odnowi się ${reason.resetsAt ?? "w nieznanym czasie"}`
        : "etap zawiódł z przyczyn infrastrukturalnych po wyczerpaniu ponowień";
    case "limit":
      return {
        time: "osiągnięto limit czasu przebiegu",
        cost: "osiągnięto limit kosztu przebiegu (szacunek zużycia)",
        turns: "sesja roli osiągnęła limit tur",
      }[reason.limit];
  }
}

export function escalation(run: Run, reason: EscalationReason): string {
  const resume = run.progress.resumeState ?? "?";
  return `Przebieg ${run.id} wymaga decyzji człowieka: ${reasonText(reason)}. Zdejmij etykietę \`${run.labels.needs_human}\`, żeby wznowić przebieg od stanu \`${resume}\` (FR-4.32), albo dodaj \`${STOP_LABEL}\`, żeby go zatrzymać.`;
}

// The body of an issue out of scope, with the Developer's description made
// safe by the caller (FR-4.10).
export function outOfScopeIssueBody(
  description: string,
  runId: string,
  issue: number,
): string {
  return `${description}\n\n---\n\nZgłoszone przez Developera w przebiegu ${runId} issue #${String(issue)} (FR-4.10). PR tego przebiegu nie naprawia tego problemu.`;
}

function issueList(issues: readonly number[]): string {
  return issues.map((number) => `#${String(number)}`).join(", ");
}

export interface PullBodyFacts {
  issue: number;
  runId: string;
  // The Developer's summary, made safe by the caller.
  summary: string;
  plan: { version: number; url: string };
  issues: readonly number[];
  // The closed pull request of an earlier run (FR-4.28b).
  previousPr?: number;
}

// The body of a run's draft pull request (FR-4.8, FR-4.10, FR-4.28b).
export function pullBody(facts: PullBodyFacts): string {
  return [
    `Closes #${String(facts.issue)}`,
    "",
    facts.summary,
    "",
    `- **Plan:** [wersja ${String(facts.plan.version)}](${facts.plan.url})`,
    ...(facts.issues.length === 0
      ? []
      : [`- **Issue spoza zakresu:** ${issueList(facts.issues)}`]),
    ...(facts.previousPr === undefined
      ? []
      : [`- **Poprzedni PR:** #${String(facts.previousPr)}`]),
    "",
    `PR przebiegu ${facts.runId}, otwarty przez pipeline jako szkic.`,
  ].join("\n");
}

// The issues out of scope of a later stage, added to the pull request body.
export function pullBodyIssues(issues: readonly number[]): string {
  return `\n- **Issue spoza zakresu z kolejnego etapu:** ${issueList(issues)}`;
}
