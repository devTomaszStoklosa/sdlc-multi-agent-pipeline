import type { RoleSession } from "../claude-runner.ts";
import { newNonce } from "../prompt-data.ts";
import { developerPrompt } from "./prompt.ts";
import { workJsonSchema } from "./work.ts";

// The Developer on Claude Code: the prompt with the brief, the changes in the
// workspace and the commit facts as the session's structured output.
export const developerSession: RoleSession = {
  prompt: (input, instructions) =>
    developerPrompt(input, instructions, newNonce()),
  outputSchema: workJsonSchema,
  toOutput: (structured) => ({ role: "developer", work: structured }),
};
