import { z } from "zod";
import { ROLE_FAILURES, usageSchema } from "../agents/role-runner.ts";
import { ROLES } from "../hooks/roles.ts";

// What a role job hands to the next job of its workflow run, which applies it
// to the run's state. The next job validates it again, as it comes from
// another job.
const outcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("plan"),
    version: z.number().int().min(1),
    highImpact: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("plan-update"),
    version: z.number().int().min(1),
    highImpact: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("pushed"),
    sha: z.string().min(1),
    branch: z.string().min(1),
    pr: z.number().int().min(1),
    // The plan version of an update published with the push (FR-4.11).
    planVersion: z.number().int().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal("verdict"),
    verdict: z.enum(["approve", "changes_requested"]),
    blockingFindings: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    failure: z.enum([...ROLE_FAILURES, "time"]),
    message: z.string(),
    resetsAt: z.string().optional(),
  }),
]);

export const roleJobOutputSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("skipped"), reason: z.string() }),
  z.strictObject({
    status: z.literal("done"),
    role: z.enum(ROLES),
    runId: z.string(),
    attempts: z.number().int().min(1),
    usage: usageSchema,
    outcome: outcomeSchema,
  }),
]);

export type RoleJobOutput = z.infer<typeof roleJobOutputSchema>;
export type RoleOutcome = z.infer<typeof outcomeSchema>;

// One line for the role job's log, with the cause of a failed stage, so the
// job in which the session failed shows why (NFR-11.3).
export function describeRoleJob(output: RoleJobOutput): string {
  if (output.status === "skipped") return `skipped (${output.reason})`;
  const { outcome } = output;
  if (outcome.kind !== "failed") return `done, ${outcome.kind}`;
  return `done, failed (${outcome.failure}): ${outcome.message}`;
}
