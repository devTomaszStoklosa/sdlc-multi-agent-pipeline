import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, lstat, open, rename } from "node:fs/promises";
import path from "node:path";
import type {
  PrepareSpec,
  RunWorkspace,
  WorkspaceChange,
} from "./workspace.ts";

const MAX_BUFFER = 20 * 1024 * 1024;
const MAX_ERROR = 2000;
// The variables a git command gets from the job. No token of the job reaches
// git, except the one of a push, which comes as configuration.
const PASSED_ENV = ["PATH", "HOME", "LANG", "TMPDIR", "TEMP", "TMP"];
const PASSED_ENV_WINDOWS = ["SYSTEMROOT", "USERPROFILE"];
const SUBMODULE_MODE = "160000";
const CONFLICT_MARKER = /^(?:<{7}|>{7})(?: |$)/m;
// Windows has no O_NOFOLLOW; the runner's Linux has.
const NO_FOLLOW = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;

export interface Identity {
  name: string;
  email: string;
}

export interface GitWorkspaceOptions {
  // The checkout of the connected repository, where the session works.
  workspace: string;
  // The job's git directory, outside the workspace and out of the session's
  // reach (plan 3.4).
  gitDir: string;
  // The base URL of the remote, such as https://github.com, for the push
  // credentials.
  serverUrl: string;
  // The GitHub App token that pushes; it reaches only the push command.
  token: string;
  identity: Identity;
  parentEnv: NodeJS.ProcessEnv;
}

interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

function configEnv(entries: readonly (readonly [string, string])[]) {
  const env: Record<string, string> = {
    GIT_CONFIG_COUNT: String(entries.length),
  };
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${String(index)}`] = key;
    env[`GIT_CONFIG_VALUE_${String(index)}`] = value;
  });
  return env;
}

// Git on the job's own git directory and the session's work tree. No system,
// global or hook configuration applies: the repository's files are data, and
// nothing the session wrote runs in the job, which holds the tokens.
export class GitWorkspace implements RunWorkspace {
  private readonly options: GitWorkspaceOptions;
  private start = "";
  private conflicts: string[] = [];

  constructor(options: GitWorkspaceOptions) {
    this.options = options;
  }

  async prepare(spec: PrepareSpec): Promise<string[]> {
    const { workspace, gitDir } = this.options;
    const own = path.join(workspace, ".git");
    if (!(await exists(gitDir))) await rename(own, gitDir);
    if (spec.branch !== undefined && (await this.onRemote(spec.branch))) {
      await this.git([
        "checkout",
        "-f",
        "-B",
        spec.branch,
        `origin/${spec.branch}`,
      ]);
    }
    this.start = await this.head();
    if (spec.merge !== undefined) await this.merge(spec.merge);
    // The session gets a copy for its own git commands, which the job never
    // reads.
    await cp(gitDir, own, { recursive: true });
    return [...this.conflicts];
  }

  async unresolved(paths: readonly string[]): Promise<string[]> {
    const marked: string[] = [];
    for (const file of paths) {
      const text = await this.readRegular(file);
      if (text !== undefined && CONFLICT_MARKER.test(text)) marked.push(file);
    }
    return marked;
  }

  async commit(message: string): Promise<boolean> {
    if (this.conflicts.length > 0) {
      await this.git(["add", "-A", "--", ...this.conflicts]);
      await this.git(["commit", "--no-verify", "--no-edit"]);
      this.conflicts = [];
    }
    await this.git(["add", "-A"]);
    const staged = await this.git(["diff", "--cached", "--quiet"], [0, 1]);
    if (staged.code === 1) {
      await this.git(["commit", "--no-verify", "-m", message]);
    }
    return (await this.head()) !== this.start;
  }

  async diff(main: string): Promise<WorkspaceChange[]> {
    const range = `origin/${main}...HEAD`;
    const raw = await this.git([
      "diff",
      "--raw",
      "-z",
      "--no-renames",
      "--no-abbrev",
      range,
    ]);
    const numstat = await this.git([
      "diff",
      "--numstat",
      "-z",
      "--no-renames",
      range,
    ]);
    const lines = parseNumstat(numstat.stdout);
    return parseRaw(raw.stdout).map(({ path: file, mode }) => ({
      path: file,
      additions: lines.get(file)?.additions ?? 0,
      deletions: lines.get(file)?.deletions ?? 0,
      submodule: mode === SUBMODULE_MODE,
    }));
  }

  async push(branch: string): Promise<string> {
    const { serverUrl, token } = this.options;
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    const header = [
      `http.${serverUrl}/.extraheader`,
      `AUTHORIZATION: basic ${basic}`,
    ] as const;
    await this.git(
      ["push", "--no-verify", "origin", `HEAD:refs/heads/${branch}`],
      [0],
      [header],
    );
    return this.head();
  }

  private async merge(merge: NonNullable<PrepareSpec["merge"]>) {
    const result = await this.git(
      [
        "merge",
        "--no-ff",
        "--no-verify",
        "-m",
        merge.message,
        `origin/${merge.main}`,
      ],
      [0, 1],
    );
    if (result.code === 0) return;
    const conflicted = await this.git([
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=U",
    ]);
    this.conflicts = conflicted.stdout
      .split("\0")
      .filter((file) => file !== "");
    if (this.conflicts.length === 0) throw gitError(["merge"], result);
  }

  private async onRemote(branch: string): Promise<boolean> {
    const ref = `refs/remotes/origin/${branch}`;
    const result = await this.git(
      ["rev-parse", "--verify", "--quiet", ref],
      [0, 1],
    );
    return result.code === 0;
  }

  private async head(): Promise<string> {
    return (await this.git(["rev-parse", "HEAD"])).stdout.trim();
  }

  // A regular file of the work tree, never through a symbolic link.
  private async readRegular(file: string): Promise<string | undefined> {
    const full = path.join(this.options.workspace, file);
    try {
      if (!(await lstat(full)).isFile()) return undefined;
      const handle = await open(full, constants.O_RDONLY | NO_FOLLOW);
      try {
        return await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      return undefined;
    }
  }

  private env(
    extra: readonly (readonly [string, string])[],
  ): NodeJS.ProcessEnv {
    const { parentEnv, identity, gitDir } = this.options;
    const env: NodeJS.ProcessEnv = {};
    for (const name of [...PASSED_ENV, ...PASSED_ENV_WINDOWS]) {
      const value = parentEnv[name];
      if (value !== undefined) env[name] = value;
    }
    return {
      ...env,
      GIT_CONFIG_NOSYSTEM: "1",
      // A file that does not exist, so no global configuration applies.
      GIT_CONFIG_GLOBAL: path.join(gitDir, "no-global-config"),
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
      ...configEnv([
        ["core.hooksPath", path.join(gitDir, "no-hooks")],
        ["core.fsmonitor", "false"],
        ["commit.gpgSign", "false"],
        ...extra,
      ]),
    };
  }

  private git(
    args: readonly string[],
    accepted: readonly number[] = [0],
    config: readonly (readonly [string, string])[] = [],
  ): Promise<GitRun> {
    const { gitDir, workspace } = this.options;
    const full = [`--git-dir=${gitDir}`, `--work-tree=${workspace}`, ...args];
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        full,
        { cwd: workspace, env: this.env(config), maxBuffer: MAX_BUFFER },
        (error, stdout, stderr) => {
          const code =
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : -1;
          const run = { code, stdout, stderr };
          if (accepted.includes(code)) resolve(run);
          else reject(gitError(args, run));
        },
      );
    });
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

// The message names the command, never its credentials, which come from the
// environment.
function gitError(args: readonly string[], run: GitRun): Error {
  const output = run.stderr.trim().slice(-MAX_ERROR);
  return new Error(
    `git ${args[0] ?? ""} failed (${String(run.code)}): ${output}`,
  );
}

// `git diff --raw -z`: ":<mode> <mode> <sha> <sha> <status>\0<path>\0".
function parseRaw(text: string): { path: string; mode: string }[] {
  const fields = text.split("\0");
  const entries: { path: string; mode: string }[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [, dstMode = ""] = (fields[index] ?? "").slice(1).split(" ");
    const file = fields[index + 1] ?? "";
    if (file !== "") entries.push({ path: file, mode: dstMode });
  }
  return entries;
}

// `git diff --numstat -z`: "<added>\t<deleted>\t<path>\0", "-" for binary.
function parseNumstat(
  text: string,
): Map<string, { additions: number; deletions: number }> {
  const lines = new Map<string, { additions: number; deletions: number }>();
  for (const entry of text.split("\0")) {
    const [added = "", deleted = "", file = ""] = entry.split("\t");
    if (file === "") continue;
    lines.set(file, {
      additions: Number(added) || 0,
      deletions: Number(deleted) || 0,
    });
  }
  return lines;
}
