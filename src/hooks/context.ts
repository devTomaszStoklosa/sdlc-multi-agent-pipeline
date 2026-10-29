import { z } from "zod";
import type { EffectiveConfig } from "../config/policy.ts";
import { ROLES, type Role } from "./roles.ts";

// What the job tells the hooks about a session. The job writes it before the
// session starts, from the run's configuration merged with the baseline.
export const hookContextSchema = z.strictObject({
  role: z.enum(ROLES),
  workspace: z.string().startsWith("/"),
  audit_log: z.string().min(1),
  rules: z.strictObject({
    deny_paths: z.array(z.string()),
    secret_paths: z.array(z.string()),
    destructive_commands: z.array(z.string()),
    allowed_hosts: z.array(z.string()),
  }),
  commands: z.strictObject({
    format: z.string().min(1),
    lint: z.string().min(1),
    test: z.string().min(1),
  }),
});

export type HookContext = z.infer<typeof hookContextSchema>;

export interface Session {
  role: Role;
  workspace: string;
  auditLog: string;
}

export function createHookContext(
  config: EffectiveConfig,
  session: Session,
): HookContext {
  const { format, lint, test } = config.commands;
  return {
    role: session.role,
    workspace: session.workspace,
    audit_log: session.auditLog,
    rules: { ...config.hooks, allowed_hosts: config.network.allowed_hosts },
    commands: { format, lint, test },
  };
}
