import { describe, expect, it } from "vitest";
import { issueOfBranch, newStubBranch } from "./branch.ts";
import { filterEvent } from "./filter.ts";

const REPO = "owner/demo";
const user = { login: "author", type: "User" };
const bot = { login: "sdlc-pipeline[bot]", type: "Bot" };

function labeled(name: string, sender = user, action = "labeled") {
  return {
    name: "issues",
    payload: { action, issue: { number: 4 }, label: { name }, sender },
  };
}

function comment(association: string, author = user, onPull = false) {
  return {
    name: "issue_comment",
    payload: {
      action: "created",
      issue: { number: 4, ...(onPull ? { pull_request: {} } : {}) },
      comment: { author_association: association, user: author },
    },
  };
}

function gates(branch: string, repository = REPO) {
  return {
    name: "workflow_run",
    payload: {
      action: "completed",
      workflow_run: {
        head_branch: branch,
        head_repository: { full_name: repository },
      },
    },
  };
}

describe("filterEvent", () => {
  it.each([
    ["a label added by a person", labeled("agent:ready")],
    ["a label removed by a person", labeled("needs-human", user, "unlabeled")],
    ["a comment of the owner", comment("OWNER")],
    ["a comment of a member", comment("MEMBER")],
    ["a comment of a collaborator", comment("COLLABORATOR")],
    ["gates of a run branch", gates("feat/4-add-discount")],
    [
      "a manual dispatch",
      { name: "workflow_dispatch", payload: { inputs: { issue: "4" } } },
    ],
  ])("lets through %s", (_name, event) => {
    expect(filterEvent(event, REPO)).toEqual({ proceed: true, issue: 4 });
  });

  it.each([
    ["a label added by a bot", labeled("plan:approved", bot)],
    ["agent:stop, which stop.yml handles", labeled("agent:stop")],
    ["agent:stop removed", labeled("agent:stop", user, "unlabeled")],
    [
      "an edited issue",
      {
        name: "issues",
        payload: { ...labeled("x").payload, action: "edited" },
      },
    ],
    ["a comment of a stranger", comment("NONE")],
    ["a comment of a contributor", comment("CONTRIBUTOR")],
    [
      "a comment of a first-time contributor",
      comment("FIRST_TIME_CONTRIBUTOR"),
    ],
    ["a comment of a bot", comment("COLLABORATOR", bot)],
    ["a comment on a pull request", comment("OWNER", user, true)],
    ["gates of a fork", gates("feat/4-add-discount", "stranger/demo")],
    ["gates of a branch without an issue", gates("main")],
    [
      "a dispatch without an issue",
      { name: "workflow_dispatch", payload: { inputs: { issue: "x" } } },
    ],
    ["another event", { name: "push", payload: {} }],
  ])("drops %s", (_name, event) => {
    expect(filterEvent(event, REPO).proceed).toBe(false);
  });

  it("drops an edited comment", () => {
    const event = comment("OWNER");
    event.payload.action = "edited";
    expect(filterEvent(event, REPO).proceed).toBe(false);
  });
});

describe("issueOfBranch", () => {
  it.each([
    ["feat/12-add-discount", 12],
    ["chore/3-stub-run-2", 3],
    ["main", undefined],
    ["feat/12", undefined],
    ["feature/12-x", undefined],
    ["feat/12-Upper", undefined],
  ])("reads %s as %s", (branch, issue) => {
    expect(issueOfBranch(branch)).toBe(issue);
  });
});

describe("newStubBranch", () => {
  it("picks a name that no branch has", async () => {
    const taken = new Set(["chore/5-stub-run", "chore/5-stub-run-2"]);
    const name = await newStubBranch(5, (candidate) =>
      Promise.resolve(taken.has(candidate)),
    );
    expect(name).toBe("chore/5-stub-run-3");
  });
});
