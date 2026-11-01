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

  it("breaks the body into lines within 100 characters (#56)", () => {
    // The body of the commit that commitlint rejected in P8.
    const body =
      "The subtotal now checks every item amount and the running sum with Number.isSafeInteger, so the cart no longer reports an imprecise amount. total inherits the check.";
    const message = commitMessage({ type: "fix", subject: "s", body }, 43);
    expect(message).toBe(
      "fix: s (#43)\n\nThe subtotal now checks every item amount and the running sum with Number.isSafeInteger, so the cart\nno longer reports an imprecise amount. total inherits the check.",
    );
  });

  it("keeps short lines and paragraphs, and cuts a word longer than a line", () => {
    const url = `https://example.com/${"a".repeat(130)}`;
    const body = `Short line.\n\nSee ${url} for details.`;
    const lines = commitMessage({ type: "docs", subject: "s", body }, 1).split(
      "\n",
    );
    expect(lines.slice(2)).toEqual([
      "Short line.",
      "",
      "See",
      url.slice(0, 100),
      `${url.slice(100)} for details.`,
    ]);
  });

  it("wraps the body after redaction", () => {
    const token = `sk-ant-oat01-${"x".repeat(120)}`;
    const message = commitMessage(
      { type: "chore", subject: "s", body: `token ${token}` },
      1,
    );
    expect(message).not.toContain("x".repeat(20));
    for (const line of message.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("mergeMessage", () => {
  it("names the main branch, the branch and the issue", () => {
    expect(mergeMessage("main", "feat/12-rabat", 12)).toBe(
      "chore: merge main into feat/12-rabat (#12)",
    );
  });
});
