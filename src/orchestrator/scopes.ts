import type { Role } from "../hooks/roles.ts";

export const TOKEN_PERMISSIONS = [
  "contents",
  "issues",
  "pull-requests",
  "checks",
] as const;
type Permission = (typeof TOKEN_PERMISSIONS)[number];
export type Scope = Partial<Record<Permission, "read" | "write">>;

// The GitHub App token of each job, narrowed to the scopes of spec 5. The
// orchestrator token has no Actions permission: only the workflow token of the
// cancel jobs may cancel runs (spec 5, plan 2.2).
export const ROLE_SCOPES: Readonly<Record<Role, Scope>> = {
  planner: { contents: "read", issues: "write" },
  developer: {
    contents: "write",
    "pull-requests": "write",
    issues: "write",
    checks: "read",
  },
  reviewer: { contents: "read", "pull-requests": "write", checks: "write" },
};

export const ORCHESTRATOR_SCOPE: Scope = {
  contents: "read",
  issues: "write",
  "pull-requests": "read",
};

// The scope of the stop and pull-request-closed workflows (FR-4.28a, FR-4.35).
export const TERMINATE_SCOPE: Scope = {
  issues: "write",
  checks: "write",
  "pull-requests": "read",
};

// One `name=value` line per permission, for the inputs of
// actions/create-github-app-token. A permission the scope lacks is empty, so
// the token does not get it.
export function scopeOutputs(scope: Scope): string[] {
  return TOKEN_PERMISSIONS.map((name) => `${name}=${scope[name] ?? ""}`);
}
