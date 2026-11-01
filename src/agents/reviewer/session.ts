import type { RoleSession } from "../claude-runner.ts";
import { newNonce } from "../prompt-data.ts";
import { reviewerPrompt } from "./prompt.ts";
import { reviewJsonSchema } from "./review.ts";

// The Reviewer on Claude Code: the prompt with the brief, and the findings as
// the session's structured output. The job turns them into a verdict.
export const reviewerSession: RoleSession = {
  prompt: (input, instructions) =>
    reviewerPrompt(input, instructions, newNonce()),
  outputSchema: reviewJsonSchema,
  toOutput: (structured) => ({ role: "reviewer", review: structured }),
};
