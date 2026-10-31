import path from "node:path";
import type { PlanBlock } from "../../agents/planner/plan-comment.ts";
import {
  DEPENDENCY_MANIFESTS,
  LOCKFILES,
} from "../../core/dependency-files.ts";
import type { ChangedFile } from "../../github/ports.ts";
import { matchesGlob } from "../../hooks/paths.ts";

export interface ScopeFinding {
  path: string;
  reason: string;
}

type PlannedFile = PlanBlock["files"][number];

// The directories whose dependency manifest the plan changes. A lockfile
// there may change without being in the plan (QG-7.9).
function manifestDirectories(plan: readonly PlannedFile[]): Set<string> {
  return new Set(
    plan
      .filter((file) => matchesGlob(file.path, DEPENDENCY_MANIFESTS))
      .map((file) => path.posix.dirname(file.path)),
  );
}

// The deterministic scope gate (QG-7.9): every file that the pull request
// changes must be in the plan. A renamed file needs both its paths in the
// plan, and a lockfile only the manifest next to it.
export function scopeFindings(
  changed: readonly ChangedFile[],
  plan: readonly PlannedFile[],
): ScopeFinding[] {
  const planned = new Set(plan.map((file) => file.path));
  const manifests = manifestDirectories(plan);
  const findings: ScopeFinding[] = [];
  for (const file of changed) {
    for (const touched of [file.previousPath, file.path]) {
      if (touched === undefined || planned.has(touched)) continue;
      const lockfile = matchesGlob(touched, LOCKFILES);
      if (lockfile && manifests.has(path.posix.dirname(touched))) continue;
      findings.push({
        path: touched,
        reason: lockfile
          ? "lockfile bez zmiany manifestu zależności w planie"
          : "plik spoza planu",
      });
    }
  }
  return findings;
}
