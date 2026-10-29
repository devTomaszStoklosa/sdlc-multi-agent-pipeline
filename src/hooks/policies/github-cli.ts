import type { ToolPolicy } from "../policy.ts";
import { invocations } from "../shell/parse.ts";

const GITHUB_CLIS = new Set(["gh", "hub"]);

// Agents have no GitHub access: the job code performs every GitHub action
// (plan 3.2). Blocking the GitHub CLI is the second layer against approvals by
// an agent (SEC-9.7) and against actions reserved for people (SEC-9.8), such as
// merging, resolving threads and changing the run's labels.
export const githubCli: ToolPolicy = {
  name: "github-cli",
  category: "role",
  check(call) {
    const used = call.commands.some(
      (command) => invocations(command, GITHUB_CLIS).length > 0,
    );
    if (!used) return undefined;
    return "Agents may not use the GitHub CLI: the pipeline performs GitHub actions itself.";
  },
};
