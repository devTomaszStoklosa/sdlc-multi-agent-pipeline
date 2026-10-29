import { describe, expect, it } from "vitest";
import { authorize, type ActorAction } from "./authorize.ts";
import { FakeGitHub } from "./fake.ts";
import type { PermissionLevel } from "./ports.ts";

// Every kind of author against every action (FR-4.1, FR-4.23, SEC-8.6, SEC-8.7).
const CASES: [PermissionLevel, ActorAction, boolean][] = [
  ["none", "label", false],
  ["read", "label", false],
  ["triage", "label", true],
  ["write", "label", true],
  ["maintain", "label", true],
  ["admin", "label", true],
  ["none", "comment", false],
  ["read", "comment", false],
  ["triage", "comment", false],
  ["write", "comment", true],
  ["maintain", "comment", true],
  ["admin", "comment", true],
  ["triage", "dispatch", false],
  ["write", "dispatch", true],
];

describe("authorize", () => {
  it.each(CASES)(
    "a user with %s may %s: %s",
    async (level, action, allowed) => {
      const github = new FakeGitHub();
      github.permissions.set("someone", level);
      const result = await authorize(
        { login: "someone", type: "User" },
        action,
        github,
      );
      expect(result.allowed).toBe(allowed);
    },
  );

  it.each([
    { login: "sdlc-pipeline[bot]", type: "Bot" },
    { login: "dependabot[bot]", type: "User" },
    { login: "github-actions", type: "Bot" },
  ])("never allows the bot $login", async (actor) => {
    const github = new FakeGitHub();
    github.permissions.set(actor.login, "admin");
    const result = await authorize(actor, "label", github);
    expect(result).toEqual({
      allowed: false,
      reason: `${actor.login} is a bot`,
    });
  });
});
