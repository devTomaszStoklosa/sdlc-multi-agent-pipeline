import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { configText } from "./fixtures.ts";

// Runs the CLI the way the npm script does, without a build step.
const CLI = join(import.meta.dirname, "cli.ts");
const directory = mkdtempSync(join(tmpdir(), "validate-config-"));

function run(...args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      CLI,
      ...args,
    ],
    { encoding: "utf8" },
  );
}

function file(name: string, text: string): string {
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
}

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("validate-config CLI", () => {
  it("exits with 0 for a valid configuration", () => {
    const result = run(file("valid.yml", configText()));
    expect(result.stdout).toContain("is valid.");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("exits with 1 when the configuration loosens config/org-baseline.yml", () => {
    const path = file(
      "looser.yml",
      configText({ limits: { max_minutes_per_run: 60 } }),
    );
    const result = run(path);
    expect(result.stderr).toContain(
      "limits.max_minutes_per_run: 60 is looser than the organization baseline 45",
    );
    expect(result.status).toBe(1);
  });

  it("exits with 1 for a configuration that does not match the schema", () => {
    const path = file("stop.yml", configText({ labels: { stop: "halt" } }));
    expect(run(path).status).toBe(1);
  });

  it("exits with 2 when the file cannot be read", () => {
    const result = run(join(directory, "missing.yml"));
    expect(result.stderr).toContain("Cannot read");
    expect(result.status).toBe(2);
  });

  it("exits with 2 without exactly one path", () => {
    const result = run();
    expect(result.stderr).toContain("Usage");
    expect(result.status).toBe(2);
  });
});
