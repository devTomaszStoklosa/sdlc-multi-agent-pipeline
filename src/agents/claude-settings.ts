import { HOOK_EVENTS } from "../hooks/hook-events.ts";

export interface SettingsOptions {
  // The program and arguments that start the hook entry point.
  hookCommand: readonly [string, ...string[]];
  contextPath: string;
  allowedHosts: readonly string[];
}

// Claude Code settings for an agent session (plan 3.4). Every hook event runs
// the pipeline hooks, and a hook that cannot start or times out blocks the
// action (SEC-9.0a). Shell commands run in the sandbox, which limits writes to
// the workspace and connections to the allowed hosts, and hides the token from
// them (SEC-9.0c, SEC-8.4). The sandbox also denies writes to the
// configuration that tools in the home directory read later and that can run
// code, such as Claude Code's own settings. It cannot deny the whole home
// directory, because the sandbox creates its own guards for shell startup
// files there. The session must load no project settings, so a repository
// cannot weaken these ones.
export function claudeSettings(options: SettingsOptions): object {
  const [program, ...programArgs] = options.hookCommand;
  const hooks = Object.fromEntries(
    [...HOOK_EVENTS].map(([cliName, event]) => [
      event.name,
      [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: program,
              args: [...programArgs, cliName, "--context", options.contextPath],
              timeout: event.timeoutSeconds,
              onFailure: "block",
            },
          ],
        },
      ],
    ]),
  );
  return {
    disableAllHooks: false,
    hooks,
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [...options.allowedHosts] },
      filesystem: { denyWrite: ["~/.claude", "~/.config", "~/.npmrc"] },
      credentials: {
        envVars: [{ name: "CLAUDE_CODE_OAUTH_TOKEN", mode: "deny" }],
      },
    },
  };
}
