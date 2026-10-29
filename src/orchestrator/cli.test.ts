import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("cli.ts", import.meta.url));
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
];

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "orchestrator-cli-"));
});

// Runs a command that needs no GitHub API and returns its job outputs.
async function run(args: string[], event?: { name: string; payload: unknown }) {
  const output = path.join(directory, "output");
  const eventPath = path.join(directory, "event.json");
  await writeFile(output, "");
  await writeFile(eventPath, JSON.stringify(event?.payload ?? {}));
  const result = spawnSync(process.execPath, [...NODE_FLAGS, CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_OUTPUT: output,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: event?.name ?? "",
      GITHUB_REPOSITORY: "owner/demo",
    },
  });
  return {
    code: result.status,
    outputs: await readFile(output, "utf8"),
    stderr: result.stderr,
  };
}

describe("orchestrator CLI", () => {
  it("writes the filter result as job outputs", async () => {
    const result = await run(["filter"], {
      name: "issue_comment",
      payload: {
        action: "created",
        issue: { number: 3 },
        comment: {
          author_association: "OWNER",
          user: { login: "a", type: "User" },
        },
      },
    });
    expect(result).toMatchObject({
      code: 0,
      outputs: "proceed=true\nissue=3\n",
    });
  });

  it("writes an empty issue for a dropped event", async () => {
    const result = await run(["filter"], { name: "push", payload: {} });
    expect(result.outputs).toBe("proceed=false\nissue=\n");
  });

  it("writes the token scope of a role", async () => {
    const result = await run(["scopes", "--role", "reviewer"]);
    expect(result.outputs).toBe(
      "contents=read\nissues=\npull-requests=write\nchecks=write\n",
    );
  });

  it("writes the target of a stop", async () => {
    const result = await run(["target"], {
      name: "issues",
      payload: {
        action: "labeled",
        issue: { number: 8 },
        label: { name: "agent:stop" },
        sender: { login: "author" },
      },
    });
    expect(result.outputs).toContain("proceed=true\nissue=8\ntarget={");
  });

  it("fails without the environment a command needs", async () => {
    const result = await run(["decide", "--issue", "1"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/is not set/);
  });

  it("rejects an unknown command", async () => {
    expect((await run(["deploy"])).code).toBe(2);
  });
});
