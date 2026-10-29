import {
  PERMISSION_LEVELS,
  type PermissionLevel,
  type PermissionsPort,
} from "./ports.ts";

export interface Actor {
  login: string;
  // "User", "Bot" or "Organization", as GitHub reports the sender.
  type: string;
}

// What an actor did, and the permission it needs: a label needs triage, the
// lowest role that can add one (FR-4.1, SEC-8.9), and a comment needs write
// (FR-4.23).
export type ActorAction = "label" | "comment" | "dispatch";

const REQUIRED: Record<ActorAction, PermissionLevel> = {
  label: "triage",
  comment: "write",
  dispatch: "write",
};

export type Authorization =
  | { allowed: true; level: PermissionLevel }
  | { allowed: false; reason: string };

export function isBot(actor: Actor): boolean {
  return actor.type === "Bot" || actor.login.endsWith("[bot]");
}

export function atLeast(
  level: PermissionLevel,
  required: PermissionLevel,
): boolean {
  return (
    PERMISSION_LEVELS.indexOf(level) >= PERMISSION_LEVELS.indexOf(required)
  );
}

// Bots never count, the pipeline's own app included, so the pipeline cannot
// trigger itself (SEC-8.7).
export async function authorize(
  actor: Actor,
  action: ActorAction,
  permissions: PermissionsPort,
): Promise<Authorization> {
  if (isBot(actor))
    return { allowed: false, reason: `${actor.login} is a bot` };
  const level = await permissions.permissionOf(actor.login);
  const required = REQUIRED[action];
  if (!atLeast(level, required)) {
    return {
      allowed: false,
      reason: `${actor.login} has ${level} permission, ${required} is required`,
    };
  }
  return { allowed: true, level };
}
