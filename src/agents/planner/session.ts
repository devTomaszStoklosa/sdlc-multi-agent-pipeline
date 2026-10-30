import type { RoleSession } from "../claude-runner.ts";
import { planJsonSchema } from "./plan.ts";
import { newNonce, plannerPrompt } from "./prompt.ts";

// The Planner on Claude Code: the prompt with the brief, and the plan as the
// session's structured output.
export const plannerSession: RoleSession = {
  prompt: (input, instructions) =>
    plannerPrompt(input, instructions, newNonce()),
  outputSchema: planJsonSchema,
  toOutput: (structured) => ({ role: "planner", plan: structured }),
};
