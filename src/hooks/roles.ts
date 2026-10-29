export const ROLES = ["planner", "developer", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const READ_TOOLS = ["Read", "Grep", "Glob"] as const;
export const WRITE_TOOLS = ["Edit", "MultiEdit", "Write", "NotebookEdit"];

// The tools each role may use (plan 3.4). Planner and Reviewer only read, so the
// Reviewer cannot change the code it reviews (FR-5.4, SEC-9.7).
export const ROLE_TOOLS: Readonly<Record<Role, readonly string[]>> = {
  planner: READ_TOOLS,
  developer: [...READ_TOOLS, ...WRITE_TOOLS, "Bash"],
  reviewer: READ_TOOLS,
};
