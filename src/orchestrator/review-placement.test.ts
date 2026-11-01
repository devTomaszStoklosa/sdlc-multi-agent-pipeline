import { describe, expect, it } from "vitest";
import { aFinding } from "../agents/reviewer/fixtures.ts";
import { commentableLines, placeFindings } from "./review-placement.ts";

const PATCH = [
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  "\\ No newline at end of file",
  "@@ -20,2 +21,2 @@",
  " const x = 1;",
  "+const y = 2;",
].join("\n");

describe("review placement", () => {
  it("knows the lines of the new version that a patch shows", () => {
    expect([...commentableLines(PATCH)]).toEqual([1, 2, 3, 4, 21, 22]);
    expect(commentableLines("")).toEqual(new Set());
  });

  it("comments on a shown line, else on the file, else only in the body", () => {
    const diff = [
      { path: "src/a.ts", additions: 3, deletions: 1, patch: PATCH },
      { path: "assets/logo.png", additions: 0, deletions: 0 },
    ];
    const placement = placeFindings(
      [
        aFinding({ id: "F-000000000001", path: "src/a.ts", line: 3 }),
        aFinding({ id: "F-000000000002", path: "src/a.ts", line: 10 }),
        aFinding({ id: "F-000000000003", path: "assets/logo.png", line: 0 }),
        aFinding({ id: "F-000000000004", path: "src/other.ts", line: 1 }),
      ],
      diff,
    );
    expect(
      placement.comments.map(({ path, line }) => ({ path, line })),
    ).toEqual([
      { path: "src/a.ts", line: 3 },
      { path: "src/a.ts", line: undefined },
      { path: "assets/logo.png", line: undefined },
    ]);
    expect(placement.comments[0]?.body).toContain(
      "<!-- sdlc-finding F-000000000001 -->",
    );
    expect(placement.detached).toEqual(new Set(["F-000000000004"]));
  });
});
