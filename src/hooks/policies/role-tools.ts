import type { ToolPolicy } from "../policy.ts";
import { RESULT_TOOL, ROLE_TOOLS } from "../roles.ts";

// Each role uses only its own tools and the tool that returns its result,
// and a tool the hooks do not know is blocked. The Reviewer gets no write
// tools and no shell (SEC-9.7, FR-5.4).
export const roleTools: ToolPolicy = {
  name: "role-tools",
  category: "role",
  check(call, context) {
    if (call.tool === RESULT_TOOL) return undefined;
    if (ROLE_TOOLS[context.role].includes(call.tool)) return undefined;
    return `The ${context.role} role may not use the ${call.tool} tool.`;
  },
};
