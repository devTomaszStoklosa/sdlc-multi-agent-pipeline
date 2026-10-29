import { describe, expect, it } from "vitest";
import { resolveTarget } from "./terminal-target.ts";
import { REPO } from "./test-harness.ts";

describe("resolveTarget", () => {
  const pull = (action: string, fields: Record<string, unknown> = {}) => ({
    name: "pull_request",
    payload: {
      action,
      label: { name: "agent:stop" },
      pull_request: {
        number: 5,
        merged: true,
        head: { ref: "chore/3-stub-run", repo: { full_name: REPO } },
        ...fields,
      },
      sender: { login: "author" },
    },
  });

  it("finds the issue of a run's pull request", () => {
    expect(resolveTarget(pull("labeled"), REPO)).toEqual({
      ok: true,
      target: { kind: "stop", issue: 3, where: "pr", pr: 5, actor: "author" },
    });
    expect(resolveTarget(pull("closed"), REPO)).toMatchObject({
      ok: true,
      target: { kind: "close", merged: true },
    });
  });

  it.each([
    [
      "a fork",
      pull("closed", {
        head: { ref: "chore/3-x", repo: { full_name: "other/demo" } },
      }),
    ],
    [
      "a branch without an issue",
      pull("closed", { head: { ref: "main", repo: { full_name: REPO } } }),
    ],
    ["another pull request action", pull("synchronize")],
    [
      "another label",
      {
        name: "issues",
        payload: {
          action: "labeled",
          issue: { number: 1 },
          label: { name: "bug" },
          sender: { login: "a" },
        },
      },
    ],
  ])("ignores %s", (_name, event) => {
    expect(resolveTarget(event, REPO).ok).toBe(false);
  });
});
