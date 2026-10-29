import type { ToolPolicy } from "../policy.ts";
import { gitInvocations } from "../shell/git.ts";

const PUSH_SUBCOMMANDS = new Set(["push", "send-pack"]);

// The job code pushes the agent's commits to the run's branch (plan 3.2), so
// an agent may not push at all. That covers protected branches, other
// branches and force pushes (SEC-9.2).
export const gitPush: ToolPolicy = {
  name: "git-push",
  category: "protected-branch",
  check(call) {
    const pushes = call.commands.some((command) =>
      gitInvocations(command).some(({ subcommand }) =>
        PUSH_SUBCOMMANDS.has(subcommand ?? ""),
      ),
    );
    if (!pushes) return undefined;
    return "Agents may not push: the pipeline pushes to the run's branch itself.";
  },
};
