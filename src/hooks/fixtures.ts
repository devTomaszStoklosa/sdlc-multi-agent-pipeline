// Shared data for the hook tests.
import type { HookContext } from "./context.ts";
import type { Role } from "./roles.ts";

export const WORKSPACE = "/work/repo";

export function hookContext(role: Role = "developer"): HookContext {
  return {
    role,
    workspace: WORKSPACE,
    audit_log: "/work/audit/tool-calls.jsonl",
    rules: {
      deny_paths: [".github/**", ".git/**"],
      secret_paths: [
        "**/.env",
        "**/.env.*",
        "**/*.pem",
        "**/id_rsa*",
        "**/.ssh/**",
        "**/.npmrc",
      ],
      destructive_commands: [
        "^git\\b.*\\s(rebase|filter-branch|filter-repo)\\b",
        "^git\\b.*\\scommit\\b.*\\s--amend\\b",
        "^git\\b.*\\sreset\\b.*\\s--hard\\b",
        "\\b(drop|truncate)\\s+(database|schema|table)\\b",
        "^(dropdb|mkfs(\\.\\w+)?|wipefs|shred)\\b",
      ],
      allowed_hosts: ["registry.npmjs.org"],
    },
    commands: {
      format: "npx prettier --write",
      lint: "npx eslint --max-warnings=0",
      test: "npm test",
    },
  };
}
