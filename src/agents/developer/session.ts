import { DEPENDENCY_MANIFESTS } from "../../core/dependency-files.ts";
import { matchesGlob } from "../../hooks/paths.ts";
import { briefOf } from "../brief.ts";
import type { RoleSession } from "../claude-runner.ts";
import { parsePlanBlock } from "../planner/plan-comment.ts";
import { newNonce } from "../prompt-data.ts";
import { developerPrompt } from "./prompt.ts";
import { workJsonSchema } from "./work.ts";

// The Developer on Claude Code: the prompt with the brief, the changes in the
// workspace and the commit facts as the session's structured output. Only
// the dependency manifests of the plan get installed after a write (#49),
// because a plan that changes one needs a human's approval (FR-6.1).
export const developerSession: RoleSession = {
  prompt: (input, instructions) =>
    developerPrompt(input, instructions, newNonce()),
  outputSchema: workJsonSchema,
  toOutput: (structured) => ({ role: "developer", work: structured }),
  manifests: (input) => {
    const brief = briefOf(input.brief, "developer");
    const files = brief && parsePlanBlock(brief.plan.body)?.files;
    return (files ?? [])
      .map((file) => file.path)
      .filter((file) => matchesGlob(file, DEPENDENCY_MANIFESTS));
  },
};
