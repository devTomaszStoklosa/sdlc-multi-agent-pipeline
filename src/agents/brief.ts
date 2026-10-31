import type { DeveloperBrief } from "./developer/brief.ts";
import type { PlannerBrief } from "./planner/brief.ts";

// What the job gathers for a role session besides the issue (SEC-8.10).
export type RoleBrief = PlannerBrief | DeveloperBrief;

export function briefOf<K extends RoleBrief["kind"]>(
  brief: RoleBrief | undefined,
  kind: K,
): Extract<RoleBrief, { kind: K }> | undefined {
  return brief?.kind === kind
    ? (brief as Extract<RoleBrief, { kind: K }>)
    : undefined;
}
