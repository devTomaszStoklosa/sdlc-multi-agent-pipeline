import { describe, expect, it } from "vitest";
import { commitMessage, mergeMessage } from "./developer-commit.ts";

describe("commitMessage", () => {
  it("builds a Conventional Commits header with the issue (FR-4.9)", () => {
    expect(
      commitMessage({ type: "fix", subject: "Round the price." }, 12),
    ).toBe("fix: round the price (#12)");
    expect(
      commitMessage(
        {
          type: "feat",
          scope: "cart",
          subject: "add a discount",
          body: "Why.",
        },
        12,
      ),
    ).toBe("feat(cart): add a discount (#12)\n\nWhy.");
  });

  it("keeps the header within 100 characters", () => {
    const message = commitMessage(
      { type: "refactor", scope: "pricing-engine", subject: "x".repeat(72) },
      12345,
    );
    expect(message.length).toBeLessThanOrEqual(100);
    expect(message.endsWith(" (#12345)")).toBe(true);
  });

  it("redacts a secret in the subject and the body (SEC-9.10)", () => {
    const token = `sk-ant-oat01-${"x".repeat(40)}`;
    const message = commitMessage(
      { type: "chore", subject: `use ${token}`, body: `token ${token}` },
      1,
    );
    expect(message).not.toContain(token);
  });
});

describe("mergeMessage", () => {
  it("names the main branch, the branch and the issue", () => {
    expect(mergeMessage("main", "feat/12-rabat", 12)).toBe(
      "chore: merge main into feat/12-rabat (#12)",
    );
  });
});
