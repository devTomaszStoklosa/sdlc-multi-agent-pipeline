import { describe, expect, it } from "vitest";
import { languagesWithFiles } from "./languages.ts";

const DEFAULT_LANGUAGES = ["actions", "javascript-typescript"];

describe("languagesWithFiles", () => {
  it("drops the languages of a commit without workflows or scripts", () => {
    expect(
      languagesWithFiles(DEFAULT_LANGUAGES, [
        "README.md",
        "package.json",
        ".sdlc-agents.yml",
        ".github/CODEOWNERS",
      ]),
    ).toEqual([]);
  });

  it("finds actions in a workflow and in a composite action", () => {
    expect(
      languagesWithFiles(["actions"], [".github/workflows/gates.yaml"]),
    ).toEqual(["actions"]);
    expect(
      languagesWithFiles(["actions"], [".github/actions/setup/action.yml"]),
    ).toEqual(["actions"]);
    expect(languagesWithFiles(["actions"], ["action.yaml"])).toEqual([
      "actions",
    ]);
  });

  it("ignores YAML that is not a top-level workflow or an action", () => {
    expect(
      languagesWithFiles(
        ["actions"],
        [
          ".github/workflows/templates/job.yml",
          ".github/dependabot.yml",
          "lefthook.yml",
          "my-action.yml",
        ],
      ),
    ).toEqual([]);
  });

  it.each([
    "src/a.js",
    "src/a.jsx",
    "a.mjs",
    "eslint.config.cjs",
    "src/a.ts",
    "src/a.tsx",
    "a.mts",
    "a.cts",
  ])("finds javascript-typescript in %s", (path) => {
    expect(languagesWithFiles(["javascript-typescript"], [path])).toEqual([
      "javascript-typescript",
    ]);
  });

  it("ignores files that only resemble scripts", () => {
    expect(
      languagesWithFiles(
        ["javascript-typescript"],
        ["package.json", "notes.ts.md", "a.mjsx"],
      ),
    ).toEqual([]);
  });

  it("keeps a language without an entry, so CodeQL still runs on it", () => {
    expect(languagesWithFiles(["python", "actions"], ["README.md"])).toEqual([
      "python",
    ]);
  });

  it("keeps the order of the configured languages", () => {
    expect(
      languagesWithFiles(DEFAULT_LANGUAGES, [
        "src/index.ts",
        ".github/workflows/ci.yml",
      ]),
    ).toEqual(DEFAULT_LANGUAGES);
  });
});
