import { execFile } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  // The end of the combined standard output and error.
  output: string;
}

// Runs a configured project command, such as the linter or the tests.
export interface CommandRunner {
  run(command: string, args: readonly string[]): Promise<CommandResult>;
}

const MAX_OUTPUT = 4000;
const MAX_BUFFER = 10 * 1024 * 1024;
// Names of variables that may hold credentials. Claude Code already removes
// them from the hook environment (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB), so this
// is the second layer.
const SECRET_NAME = /TOKEN|SECRET|PASSW|API_?KEY|PRIVATE|CREDENTIAL|AUTH/i;

function tail(text: string): string {
  return text.length > MAX_OUTPUT ? `…${text.slice(-MAX_OUTPUT)}` : text;
}

export function sandboxEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !SECRET_NAME.test(name)),
  );
}

// bubblewrap arguments for a project command. Hooks run outside the Claude
// Code sandbox, while the linter and the tests run code that the agent may
// have changed. So the command gets new process and network namespaces: it
// sees no other process, and with it no process environment that holds the
// token, and it cannot connect anywhere. Only the workspace and a private
// /tmp are writable, so it cannot change the session's hooks or the files that
// GitHub Actions reads between steps. The arguments reach the command as
// positional parameters, so a file name is never parsed as shell code.
export function sandboxArguments(
  workspace: string,
  command: string,
  args: readonly string[],
): string[] {
  return [
    ["--ro-bind", "/", "/"],
    ["--dev", "/dev"],
    ["--proc", "/proc"],
    ["--tmpfs", "/tmp"],
    ["--bind", workspace, workspace],
    ["--chdir", workspace],
    ["--setenv", "TMPDIR", "/tmp"],
    ["--setenv", "npm_config_cache", "/tmp/npm-cache"],
    ["--unshare-pid", "--unshare-net", "--unshare-ipc"],
    ["--new-session", "--die-with-parent"],
    ["--", "sh", "-c", `${command} "$@"`, "sh", ...args],
  ].flat();
}

// Runs project commands in bubblewrap (`bwrap`). Without bubblewrap the hook
// fails, and a failed hook blocks (SEC-9.0a).
export class SandboxedCommandRunner implements CommandRunner {
  private readonly workspace: string;
  private readonly timeoutMs: number;

  constructor(workspace: string, timeoutMs: number) {
    this.workspace = workspace;
    this.timeoutMs = timeoutMs;
  }

  run(command: string, args: readonly string[]): Promise<CommandResult> {
    const options = {
      env: sandboxEnvironment(process.env),
      timeout: this.timeoutMs,
      maxBuffer: MAX_BUFFER,
    };
    const bwrapArgs = sandboxArguments(this.workspace, command, args);
    return new Promise((resolve, reject) => {
      execFile("bwrap", bwrapArgs, options, (error, stdout, stderr) => {
        if (error?.code === "ENOENT") {
          reject(new Error("bubblewrap (bwrap) is not installed"));
        } else {
          resolve({ ok: error === null, output: tail(`${stdout}${stderr}`) });
        }
      });
    });
  }
}
