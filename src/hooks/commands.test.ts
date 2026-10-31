import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SandboxedCommandRunner,
  sandboxArguments,
  sandboxEnvironment,
} from "./commands.ts";

describe("sandboxEnvironment", () => {
  it("drops variables whose names look like credentials", () => {
    const environment = {
      PATH: "/usr/bin",
      HOME: "/home/runner",
      CLAUDE_CODE_OAUTH_TOKEN: "x",
      GITHUB_TOKEN: "x",
      NPM_AUTH: "x",
      DB_PASSWORD: "x",
      AWS_SECRET_ACCESS_KEY: "x",
    };
    expect(sandboxEnvironment(environment)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/runner",
    });
  });
});

describe("sandboxArguments", () => {
  const args = sandboxArguments("/work/repo", "npx eslint", ["a b.ts"]);

  it("isolates processes and the network", () => {
    expect(args).toEqual(
      expect.arrayContaining(["--unshare-pid", "--unshare-net"]),
    );
  });

  it("makes the root read-only before binding the workspace writable", () => {
    const joined = args.join(" ");
    expect(joined).toContain("--ro-bind / /");
    expect(joined.indexOf("--ro-bind / /")).toBeLessThan(
      joined.indexOf("--bind /work/repo /work/repo"),
    );
  });

  it("gives only the install command the network", () => {
    const install = sandboxArguments("/work/repo", "npm ci", [], true);
    expect(install).toContain("--unshare-pid");
    expect(install).not.toContain("--unshare-net");
  });

  it("passes the file names as positional parameters", () => {
    expect(args.slice(args.indexOf("--"))).toEqual([
      "--",
      "sh",
      "-c",
      'npx eslint "$@"',
      "sh",
      "a b.ts",
    ]);
  });
});

describe("SandboxedCommandRunner without bubblewrap", () => {
  const savedPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = savedPath;
  });

  it("fails, so the hook fails closed", async () => {
    process.env.PATH = "";
    const runner = new SandboxedCommandRunner("/work/repo", 1000);
    await expect(runner.run("true", [])).rejects.toThrow("not installed");
  });
});

// These tests need bubblewrap on Linux. CI sets REQUIRE_SANDBOX=1, so there
// they fail instead of being skipped when bubblewrap is missing.
const sandboxAvailable =
  process.env.REQUIRE_SANDBOX === "1" ||
  spawnSync("bwrap", ["--version"]).status === 0;

describe.runIf(sandboxAvailable)(
  "SandboxedCommandRunner with bubblewrap",
  () => {
    async function setUp() {
      const workspace = await mkdtemp(path.join(tmpdir(), "sandbox-ws-"));
      return {
        workspace,
        runner: new SandboxedCommandRunner(workspace, 30_000),
      };
    }

    it("runs a command in the workspace with its file arguments", async () => {
      const { workspace, runner } = await setUp();
      const result = await runner.run("printf '%s|' \"$PWD\"", [
        "a b.ts",
        "$(id)",
      ]);
      expect(result).toEqual({
        ok: true,
        output: `${workspace}|a b.ts|$(id)|`,
      });
    });

    it("writes inside the workspace but not outside it", async () => {
      const { workspace, runner } = await setUp();
      // Outside /tmp, which the sandbox replaces, so the directory exists there.
      const outside = await mkdtemp(path.join(homedir(), ".sandbox-out-"));
      try {
        // The runner appends the file name, so the command ends with `>`.
        const write = "echo x >";
        const inside = path.join(workspace, "file.txt");
        expect((await runner.run(write, [inside])).ok).toBe(true);
        expect(await readFile(inside, "utf8")).toBe("x\n");
        const result = await runner.run(write, [path.join(outside, "file")]);
        expect(result.ok).toBe(false);
        expect(result.output).toContain("Read-only file system");
      } finally {
        await rm(outside, { recursive: true });
      }
    });

    it("does not see the environment of other processes", async () => {
      const { runner } = await setUp();
      const marker = `probe-${String(Date.now())}`;
      const other = spawn("sleep", ["30"], {
        env: { ...process.env, PROBE: marker },
      });
      await once(other, "spawn");
      try {
        const search = 'grep -ls "$1" /proc/[0-9]*/environ; true';
        // Without the sandbox the same search finds the other process.
        const control = spawnSync(
          "sh",
          ["-c", `${search} "$@"`, "sh", marker],
          {
            encoding: "utf8",
          },
        );
        expect(control.stdout).toContain("/environ");
        expect(await runner.run(search, [marker])).toEqual({
          ok: true,
          output: "",
        });
      } finally {
        other.kill();
      }
    });

    it("cannot connect to the network", async () => {
      const { runner } = await setUp();
      const connect =
        "node -e \"require('net').connect(443, '1.1.1.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))\"";
      expect((await runner.run(connect, [])).ok).toBe(false);
    });
  },
);
