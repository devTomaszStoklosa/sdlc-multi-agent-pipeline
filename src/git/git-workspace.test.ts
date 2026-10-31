import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GitWorkspace } from "./git-workspace.ts";

const IDENTITY = {
  name: "sdlc-app[bot]",
  email: "sdlc-app[bot]@users.noreply.github.com",
};

let root = "";
let origin = "";
let workspace = "";
let gitDir = "";

// Git of the test itself, with a person's identity. Like the job's git, it
// reads no system or global configuration, so line endings stay as written.
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Author", "-c", "user.email=author@example.com", ...args],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: path.join(tmpdir(), "no-global-config"),
      },
    },
  ).trim();
}

async function commitFile(
  cwd: string,
  file: string,
  text: string,
  message: string,
) {
  await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
  await writeFile(path.join(cwd, file), text);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
}

// A remote with a main branch and a clone of it, like the job's checkout with
// its whole history.
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "git-workspace-"));
  origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const seed = path.join(root, "seed");
  git(root, "clone", "-q", origin, seed);
  await commitFile(
    seed,
    "src/price.ts",
    "export const a = 1;\n",
    "feat: add a",
  );
  git(seed, "push", "-q", "origin", "HEAD:main");
  workspace = path.join(root, "workspace");
  gitDir = path.join(root, "job-git");
});

function clone(): void {
  git(root, "clone", "-q", origin, workspace);
}

function workspaceOf(): GitWorkspace {
  return new GitWorkspace({
    workspace,
    gitDir,
    serverUrl: "https://github.com",
    token: "app-token",
    identity: IDENTITY,
    parentEnv: process.env,
  });
}

// Another person pushes to the remote.
async function pushFrom(
  branch: string,
  file: string,
  text: string,
  base = "main",
) {
  const other = await mkdtemp(path.join(root, "other-"));
  git(root, "clone", "-q", origin, other);
  git(other, "checkout", "-q", "-B", branch, `origin/${base}`);
  await commitFile(other, file, text, `chore: change ${file}`);
  git(other, "push", "-q", "origin", `HEAD:${branch}`);
}

function originLog(ref: string, format: string): string {
  return git(origin, "log", "-1", `--format=${format}`, ref);
}

// Each test runs a few dozen git commands, which take long on Windows.
describe("GitWorkspace", { timeout: 60_000 }, () => {
  it("commits and pushes the session's changes with its own git directory", async () => {
    clone();
    const work = workspaceOf();
    expect(await work.prepare({})).toEqual([]);
    expect(existsSync(path.join(gitDir, "HEAD"))).toBe(true);
    // The session has its own copy of the git directory.
    expect(existsSync(path.join(workspace, ".git", "HEAD"))).toBe(true);
    await writeFile(
      path.join(workspace, "src/price.ts"),
      "export const a = 2;\n",
    );
    await writeFile(
      path.join(workspace, "src/new.ts"),
      "export const b = 1;\n",
    );
    expect(await work.commit("feat: change a (#12)")).toBe(true);
    expect(await work.diff("main")).toEqual([
      { path: "src/new.ts", additions: 1, deletions: 0, submodule: false },
      { path: "src/price.ts", additions: 1, deletions: 1, submodule: false },
    ]);
    const sha = await work.push("feat/12-change-a");
    expect(originLog("feat/12-change-a", "%H")).toBe(sha);
    expect(originLog("feat/12-change-a", "%s|%an|%ae")).toBe(
      `feat: change a (#12)|${IDENTITY.name}|${IDENTITY.email}`,
    );
  });

  it("reports a session that changed nothing", async () => {
    clone();
    const work = workspaceOf();
    await work.prepare({});
    expect(await work.commit("feat: nothing (#12)")).toBe(false);
  });

  it("leaves out the empty files that the sandbox mounts over", async () => {
    await pushFrom("main", "yarn.lock", "");
    clone();
    const work = workspaceOf();
    await work.prepare({});
    for (const file of [".env", ".gitmodules", "pnpm-lock.yaml"]) {
      await writeFile(path.join(workspace, file), "");
    }
    // A placeholder name with content, or one the branch has, stays.
    await writeFile(path.join(workspace, "bunfig.toml"), "[install]\n");
    await writeFile(
      path.join(workspace, "src/new.ts"),
      "export const b = 1;\n",
    );
    expect(await work.commit("feat: add b (#12)")).toBe(true);
    expect((await work.diff("main")).map((change) => change.path)).toEqual([
      "bunfig.toml",
      "src/new.ts",
    ]);
    expect(existsSync(path.join(workspace, ".env"))).toBe(false);
    expect(existsSync(path.join(workspace, "yarn.lock"))).toBe(true);
  });

  it("runs no hook or configuration that the session wrote", async () => {
    clone();
    const work = workspaceOf();
    await work.prepare({});
    const marker = path.join(root, "hook-ran");
    const hook = `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\n`;
    for (const dir of [
      path.join(workspace, ".git", "hooks"),
      path.join(gitDir, "hooks"),
    ]) {
      await writeFile(path.join(dir, "pre-commit"), hook);
      await writeFile(path.join(dir, "commit-msg"), hook);
      await chmod(path.join(dir, "pre-commit"), 0o755);
      await chmod(path.join(dir, "commit-msg"), 0o755);
    }
    git(workspace, "config", "core.hooksPath", ".git/hooks");
    await writeFile(
      path.join(workspace, "src/new.ts"),
      "export const b = 1;\n",
    );
    expect(await work.commit("feat: add b (#12)")).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  it("checks out the run's branch and merges the main branch into it", async () => {
    await pushFrom("feat/12-a", "src/branch.ts", "export const c = 1;\n");
    await pushFrom("main", "src/main.ts", "export const d = 1;\n");
    clone();
    const work = workspaceOf();
    const conflicts = await work.prepare({
      branch: "feat/12-a",
      merge: {
        main: "main",
        message: "chore: merge main into feat/12-a (#12)",
      },
    });
    expect(conflicts).toEqual([]);
    expect(existsSync(path.join(workspace, "src/branch.ts"))).toBe(true);
    expect(existsSync(path.join(workspace, "src/main.ts"))).toBe(true);
    // The merge alone is new and goes to the branch.
    expect(await work.commit("feat: nothing more (#12)")).toBe(true);
    await work.push("feat/12-a");
    expect(originLog("feat/12-a", "%s|%p").split("|")[0]).toBe(
      "chore: merge main into feat/12-a (#12)",
    );
    expect(originLog("feat/12-a", "%p").split(" ")).toHaveLength(2);
    expect((await work.diff("main")).map((change) => change.path)).toEqual([
      "src/branch.ts",
    ]);
  });

  it("leaves the conflicts of the merge to the session and commits the resolution as the merge", async () => {
    await pushFrom("feat/12-a", "src/price.ts", "export const a = 2;\n");
    await pushFrom("main", "src/price.ts", "export const a = 3;\n");
    clone();
    const work = workspaceOf();
    const conflicts = await work.prepare({
      branch: "feat/12-a",
      merge: {
        main: "main",
        message: "chore: merge main into feat/12-a (#12)",
      },
    });
    expect(conflicts).toEqual(["src/price.ts"]);
    expect(await work.unresolved(conflicts)).toEqual(["src/price.ts"]);
    await writeFile(
      path.join(workspace, "src/price.ts"),
      "export const a = 4;\n",
    );
    await writeFile(
      path.join(workspace, "src/new.ts"),
      "export const b = 1;\n",
    );
    expect(await work.unresolved(conflicts)).toEqual([]);
    expect(await work.commit("feat: add b (#12)")).toBe(true);
    await work.push("feat/12-a");
    expect(originLog("feat/12-a", "%s")).toBe("feat: add b (#12)");
    expect(originLog("feat/12-a~1", "%s")).toBe(
      "chore: merge main into feat/12-a (#12)",
    );
    expect(originLog("feat/12-a~1", "%p").split(" ")).toHaveLength(2);
    expect(git(origin, "show", "feat/12-a:src/price.ts")).toBe(
      "export const a = 4;",
    );
  });

  it("marks a nested repository in the diff", async () => {
    clone();
    const work = workspaceOf();
    await work.prepare({});
    const nested = path.join(workspace, "vendor/lib");
    await mkdir(nested, { recursive: true });
    git(nested, "init", "-q", "-b", "main");
    await commitFile(nested, "x.txt", "x\n", "chore: x");
    expect(await work.commit("chore: add lib (#12)")).toBe(true);
    const changes = await work.diff("main");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: "vendor/lib", submodule: true });
  });

  it("names the failed git command without the token", async () => {
    clone();
    const work = workspaceOf();
    await work.prepare({});
    await writeFile(
      path.join(workspace, "src/new.ts"),
      "export const b = 1;\n",
    );
    await work.commit("feat: add b (#12)");
    // A remote that no longer exists, in the job's own git directory.
    git(
      root,
      `--git-dir=${gitDir}`,
      "remote",
      "set-url",
      "origin",
      path.join(root, "missing.git"),
    );
    const failure = work.push("feat/12-b");
    await expect(failure).rejects.toThrow(/^git push failed/);
    await expect(failure).rejects.not.toThrow(/app-token/);
  });
});
