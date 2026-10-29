import type { ToolPolicy } from "../policy.ts";
import { ROLE_TOOLS } from "../roles.ts";

// Each role uses only its own tools, and a tool the hooks do not know is
// blocked. The Reviewer gets no write tools and no shell (SEC-9.7, FR-5.4).
export const roleTools: ToolPolicy = {
  name: "role-tools",
  category: "role",
  check(call, context) {
    if (ROLE_TOOLS[context.role].includes(call.tool)) return undefined;
    return `The ${context.role} role may not use the ${call.tool} tool.`;
  },
};
