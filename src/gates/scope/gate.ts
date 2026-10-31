import { z } from "zod";
import {
  latestPlan,
  planEntries,
  type PlanEntry,
} from "../../agents/planner/plan-comment.ts";
import type { CommentsPort, ContentsPort } from "../../github/ports.ts";
import { issueOfBranch } from "../../orchestrator/branch.ts";
import { scopeFindings, type ScopeFinding } from "./check.ts";

export interface GateSources {
  comments: CommentsPort;
  contents: ContentsPort;
  // The pipeline's app, the author of the plan comments.
  appId: number;
  repository: string;
}

const pullEvent = z.object({
  pull_request: z.object({
    user: z.object({ login: z.string(), type: z.string() }),
    head: z.object({
      ref: z.string(),
      sha: z.string(),
      repo: z.object({ full_name: z.string() }).nullable(),
    }),
    base: z.object({ ref: z.string() }),
  }),
});

export type GateResult =
  | { applies: false; reason: string }
  | {
      applies: true;
      issue: number;
      plan: PlanEntry | undefined;
      findings: ScopeFinding[];
    };

// The pull request of a run: a bot opened it from a run branch of this
// repository (FR-4.7). The gate passes other pull requests, which the
// required check of the ruleset covers too.
function runIssue(
  pull: z.infer<typeof pullEvent>["pull_request"],
  repository: string,
): number | undefined {
  if (pull.user.type !== "Bot") return undefined;
  if (pull.head.repo?.full_name !== repository) return undefined;
  return issueOfBranch(pull.head.ref);
}

// The scope gate of a pull_request event (QG-7.9): the files that the pull
// request changes against its base, compared with the newest plan that the
// pipeline posted on the issue.
export async function runScopeGate(
  sources: GateSources,
  event: { name: string; payload: unknown },
): Promise<GateResult> {
  if (event.name !== "pull_request") {
    return {
      applies: false,
      reason: `zdarzenie ${event.name} to nie pull request`,
    };
  }
  const { pull_request: pull } = pullEvent.parse(event.payload);
  const issue = runIssue(pull, sources.repository);
  if (issue === undefined) {
    return { applies: false, reason: "PR nie należy do przebiegu pipeline'u" };
  }
  const plan = latestPlan(
    planEntries(await sources.comments.listComments(issue), sources.appId),
  );
  if (plan === undefined) return { applies: true, issue, plan, findings: [] };
  const changed = await sources.contents.compare(pull.base.ref, pull.head.sha);
  return {
    applies: true,
    issue,
    plan,
    findings: scopeFindings(changed, plan.block.files),
  };
}

export function passed(result: GateResult): boolean {
  return (
    !result.applies ||
    (result.plan !== undefined && result.findings.length === 0)
  );
}

// The gate's result for the log and the step summary, which people and the
// Developer read (FR-4.12).
export function report(result: GateResult): string {
  if (!result.applies) {
    return `Bramka zakresu nie dotyczy tego zdarzenia: ${result.reason}.`;
  }
  const issue = `#${String(result.issue)}`;
  if (result.plan === undefined) {
    return `Bramka zakresu niezaliczona: issue ${issue} nie ma planu pipeline'u, więc żaden plik PR nie jest w planie.`;
  }
  const { run, version } = result.plan.block;
  const source = `planu ${String(version)} przebiegu ${run} issue ${issue} (${result.plan.url})`;
  if (result.findings.length === 0) {
    return `Bramka zakresu zaliczona: każdy zmieniony plik jest w zakresie ${source}.`;
  }
  return [
    `Bramka zakresu niezaliczona: PR zmienia pliki spoza ${source} (QG-7.9). Usuń te zmiany albo zaktualizuj plan (FR-4.11).`,
    "",
    ...result.findings.map(
      (finding) => `- \`${finding.path}\`: ${finding.reason}`,
    ),
  ].join("\n");
}
