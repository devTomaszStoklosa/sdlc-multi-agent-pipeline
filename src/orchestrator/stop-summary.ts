import { STOP_LABEL } from "../config/schema.ts";
import type { Run } from "../core/run-store/run-record.ts";
import type { RunStateName } from "../core/state-machine/states.ts";
import type { RunLimits } from "./limits.ts";

export interface StopFacts {
  run: Run;
  // The state and review round when the label was added.
  state: RunStateName;
  by: string;
  where: "issue" | "pr";
  labeledAt: string;
  pullUrl?: string;
  // The role session that was running, if any, and what ended it.
  session?: EndedSession;
  // Side effects that had passed their check before the stop and finished
  // after it (FR-4.28c).
  finishedAfterStop: string[];
  cancelledChecks: number;
  usedMinutes: number;
  usedCostUsd: number;
  limits: RunLimits | undefined;
}

export interface EndedSession {
  role: string;
  endedBy: "watch" | "cancel";
}

function sessionText(session: EndedSession | undefined): string {
  if (session === undefined) return "brak trwającej sesji agenta";
  return session.endedBy === "watch"
    ? `sesja roli ${session.role} przerwana przez job roli po wykryciu zatrzymania`
    : `sesja roli ${session.role} zakończona przez anulowanie runu`;
}

function line(label: string, value: string): string {
  return `- **${label}:** ${value}`;
}

function interrupted(facts: StopFacts): string[] {
  const items = [
    sessionText(facts.session),
    facts.cancelledChecks > 0
      ? `check run \`agent-review\` zakończony wynikiem \`cancelled\` (${String(facts.cancelledChecks)})`
      : "brak check runa `agent-review` w toku",
    facts.finishedAfterStop.length > 0
      ? `dokończone po zatrzymaniu: ${facts.finishedAfterStop.join(", ")}`
      : "brak operacji dokończonych po zatrzymaniu",
    "brak zaplanowanych działań do porzucenia: ponowienia działają w jobie roli, obsługa komentarzy po opóźnieniu wchodzi w F2",
    "brak wdrożenia na dev w MVP",
  ];
  return items.map((item) => `  - ${item}`);
}

function usage(facts: StopFacts): string {
  const minutes = facts.usedMinutes.toFixed(1);
  const cost = facts.usedCostUsd.toFixed(2);
  if (facts.limits === undefined) return `${minutes} min, ${cost} USD`;
  return `${minutes} z ${String(facts.limits.maxMinutes)} min w stanach pracy, ${cost} z ${String(facts.limits.maxCostUsd)} USD (szacunek zużycia, nie wydatek)`;
}

// The first line of a stop summary, by which a later run finds it (FR-4.28b).
export function stopSummaryHeading(runId: string): string {
  return `### Przebieg ${runId} zatrzymany`;
}

// The one comment of a stopped run (FR-4.28f), built from the run state and
// the event log without a model.
export function stopSummary(facts: StopFacts): string {
  const { run } = facts;
  const where = facts.where === "pr" ? "w PR" : "w issue";
  const findings = run.progress.findings;
  return [
    stopSummaryHeading(run.id),
    "",
    line(
      "Zatrzymał",
      `@${facts.by}, etykietą \`${STOP_LABEL}\` ${where}, ${facts.labeledAt}`,
    ),
    line(
      "Stan w chwili zatrzymania",
      `\`${facts.state}\`, runda review ${String(run.progress.reviewRound)}`,
    ),
    line("Branch", run.branch ? `\`${run.branch}\`` : "brak"),
    line("PR", facts.pullUrl ?? "brak"),
    line("Ostatni wypchnięty commit", run.progress.pushedSha ?? "brak"),
    line(
      "Znaleziska blokujące z review",
      findings.length > 0 ? findings.join(", ") : "brak",
    ),
    line("Przerwane działania", ""),
    ...interrupted(facts),
    line("Zużycie", usage(facts)),
    "",
    `Nowy przebieg: zdejmij \`${STOP_LABEL}\` z issue i z PR, a potem dodaj \`${run.labels.ready}\` (FR-4.28b). Merge PR wymaga teraz obejścia checku \`agent-review\` przez administratora (FR-6.3).`,
  ].join("\n");
}
