import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { removeLockfilePlaceholders } from "./dependency-install.ts";

describe("removeLockfilePlaceholders", () => {
  it("removes only the empty lockfiles among the sandbox's mount points", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "placeholders-"));
    await writeFile(path.join(workspace, "yarn.lock"), "");
    await writeFile(
      path.join(workspace, "pnpm-lock.yaml"),
      "lockfileVersion: 9",
    );
    await writeFile(path.join(workspace, ".yarnrc"), "");
    await writeFile(path.join(workspace, "package-lock.json"), "");
    await removeLockfilePlaceholders(workspace);
    expect((await readdir(workspace)).sort()).toEqual([
      ".yarnrc",
      "package-lock.json",
      "pnpm-lock.yaml",
    ]);
  });
});
