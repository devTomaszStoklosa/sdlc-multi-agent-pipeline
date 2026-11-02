import { DEPENDENCY_MANIFESTS } from "../../core/dependency-files.ts";
import { matchesGlob } from "../../hooks/paths.ts";
import { parsePlanBlock } from "../planner/plan-comment.ts";

// The dependency manifests among the files of a plan comment, which the hooks
// install after a write (#49) and which need `commands.update_lockfile` (#58).
export function planManifests(planBody: string): string[] {
  return (parsePlanBlock(planBody)?.files ?? [])
    .map((file) => file.path)
    .filter((file) => matchesGlob(file, DEPENDENCY_MANIFESTS));
}
