import { describe, expect, it } from "vitest";
import { aFinding, aRecord } from "./fixtures.ts";
import {
  developerReplies,
  findingComment,
  findingsById,
  findingThreads,
  openBlocking,
  parseReviewRecord,
  replyComment,
  reviewBody,
  runReviews,
} from "./review-comment.ts";

const BOT = "pipeline[bot]";

function review(body: string, authorLogin = BOT) {
  return { id: 1, authorLogin, body, url: "https://github.test/r/1" };
}

describe("review comments", () => {
  it("keeps the record of a review in its body", () => {
    const record = aRecord({
      findings: [
        aFinding({ description: "Tekst z --> i <!-- w środku --!> też." }),
      ],
    });
    const body = reviewBody(record, new Set());
    expect(body).toContain(
      "### Review, runda 1 (przebieg 12-1): `changes_requested`",
    );
    expect(body.match(/-->/g)).toHaveLength(1);
    expect(parseReviewRecord(body)).toEqual(record);
  });

  it("redacts secrets in the record and the visible text", () => {
    const secret = `ghp_${"a".repeat(36)}`;
    const record = aRecord({
      findings: [aFinding({ description: `Token ${secret} w kodzie.` })],
    });
    const body = reviewBody(record, new Set([record.findings[0]?.id ?? ""]));
    expect(body).not.toContain(secret);
    expect(findingComment(aFinding({ suggestion: secret }))).not.toContain(
      secret,
    );
  });

  it("describes in the body only the findings without a comment", () => {
    const shown = aFinding({ id: "F-000000000001", description: "Widoczne." });
    const detached = aFinding({ id: "F-000000000002", description: "Osobne." });
    const body = reviewBody(
      aRecord({ findings: [shown, detached] }),
      new Set([detached.id]),
    );
    expect(body).toContain("- **F-000000000001** · blokujące · `kiss`");
    expect(body.split("<!-- sdlc-review")[0]).not.toContain("Widoczne.");
    expect(body).toContain("  Osobne.");
  });

  it("counts only the reviews of the app's bot for the run", () => {
    const own = reviewBody(aRecord(), new Set());
    const other = reviewBody(aRecord({ run: "12-2" }), new Set());
    const reviews = runReviews(
      [review(own), review(own, "someone"), review(other), review("Hi")],
      BOT,
      "12-1",
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.url).toBe("https://github.test/r/1");
  });

  it("leaves open the blocking findings and the unresolved earlier ones", () => {
    const record = aRecord({
      findings: [
        aFinding({ id: "F-000000000001" }),
        aFinding({ id: "F-000000000002", blocking: false }),
      ],
      earlier: [
        { id: "F-000000000003", resolved: false, note: "Nadal jest." },
        { id: "F-000000000004", resolved: true, note: "Poprawione." },
      ],
    });
    expect(openBlocking(record)).toEqual(["F-000000000001", "F-000000000003"]);
    const later = aRecord({
      findings: [aFinding({ id: "F-000000000001", line: 9 })],
    });
    const byId = findingsById([
      { record, url: "" },
      { record: later, url: "" },
    ]);
    expect(byId.get("F-000000000001")?.line).toBe(2);
  });

  it("finds the thread of a finding and the Developer's replies", () => {
    const comment = findingComment(aFinding());
    const reply = replyComment("F-0123456789ab", "To celowe.");
    const threads = findingThreads(
      [
        { id: 10, authorLogin: BOT, body: comment },
        { id: 11, authorLogin: "someone", body: comment },
        { id: 12, authorLogin: BOT, body: reply, inReplyTo: 10 },
      ],
      BOT,
    );
    expect(threads).toEqual(new Map([["F-0123456789ab", 10]]));
    expect(developerReplies([reply, comment])).toEqual(
      new Map([["F-0123456789ab", ["**Odpowiedź Developera:** To celowe."]]]),
    );
  });
});
