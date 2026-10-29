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
