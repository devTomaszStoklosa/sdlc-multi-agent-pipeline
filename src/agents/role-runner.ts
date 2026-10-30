import { z } from "zod";
import type { Role } from "../hooks/roles.ts";
import type { RoleBrief } from "./brief.ts";
import { planSchema } from "./planner/plan.ts";

// What a role session gets (plan 3.4). A session also gets the workspace,
// which the runner knows; the stubs need only these facts.
export interface RoleInput {
  role: Role;
  issue: { number: number; title: string; body: string };
  runId: string;
  planVersion: number;
  reviewRound: number;
  pushes: number;
  findings: readonly string[];
  // 1 for the first attempt of the stage, more for its retries (FR-4.30).
  attempt: number;
  // The run's .sdlc-agents.yml copy (FR-10.5) and the turn limit of a stage.
  config: string;
  maxTurns: number;
  // What the job gathered for the role (FR-4.12, FR-4.28b, SEC-8.10).
  brief?: RoleBrief;
}

const count = z.number().int().min(0);

export const usageSchema = z.strictObject({
  input_tokens: count,
  output_tokens: count,
  cost_usd: z.number().min(0),
  turns: count,
});

const plannerOutput = z.strictObject({
  role: z.literal("planner"),
  plan: planSchema,
});

const developerOutput = z.strictObject({
  role: z.literal("developer"),
  change: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("push"),
      path: z.string().min(1),
      content: z.string(),
      message: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("plan-update"),
      highImpact: z.boolean(),
      text: z.string().min(1),
    }),
  ]),
});

const reviewerOutput = z.strictObject({
  role: z.literal("reviewer"),
  verdict: z.enum(["approve", "changes_requested"]),
  findings: z.array(
    z.strictObject({
      id: z.string().min(1),
      blocking: z.boolean(),
      summary: z.string(),
    }),
  ),
});

export const ROLE_FAILURES = ["infra", "usage-limit", "max-turns"] as const;

// The result of one session. The job validates it with this schema before
// any side effect, so a session can change only the content of its result
// (plan 3.2).
export const roleResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    usage: usageSchema,
    output: z.discriminatedUnion("role", [
      plannerOutput,
      developerOutput,
      reviewerOutput,
    ]),
  }),
  z.strictObject({
    status: z.literal("failed"),
    usage: usageSchema,
    failure: z.enum(ROLE_FAILURES),
    message: z.string(),
    resetsAt: z.iso.datetime({ offset: true }).optional(),
  }),
]);

export type RoleResult = z.infer<typeof roleResultSchema>;
export type RoleOutput = Extract<RoleResult, { status: "ok" }>["output"];
export type RoleUsage = RoleResult["usage"];
export type RoleFailure = (typeof ROLE_FAILURES)[number];

// The adapter of a role (spec 13.4). The result is unvalidated, as it comes
// from the session.
export interface RoleRunner {
  run(input: RoleInput, signal: AbortSignal): Promise<unknown>;
}
