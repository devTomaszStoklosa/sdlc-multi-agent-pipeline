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

function tail(text: string): string {
  return text.length > MAX_OUTPUT ? `…${text.slice(-MAX_OUTPUT)}` : text;
}

// Runs the command through `sh -c` in the workspace and passes the arguments
// as positional parameters, so a file name is never parsed as shell code.
export class ShellCommandRunner implements CommandRunner {
  private readonly workspace: string;
  private readonly timeoutMs: number;

  constructor(workspace: string, timeoutMs: number) {
    this.workspace = workspace;
    this.timeoutMs = timeoutMs;
  }

  run(command: string, args: readonly string[]): Promise<CommandResult> {
    const script = `${command} "$@"`;
    const options = {
      cwd: this.workspace,
      timeout: this.timeoutMs,
      maxBuffer: MAX_BUFFER,
    };
    return new Promise((resolve) => {
      execFile(
        "sh",
        ["-c", script, "sh", ...args],
        options,
        (error, stdout, stderr) => {
          resolve({ ok: error === null, output: tail(`${stdout}${stderr}`) });
        },
      );
    });
  }
}
