import { describe, expect, it } from "vitest";
import { newAlerts, parseAlerts, severityOf } from "./sarif.ts";

interface Finding {
  ruleId: string;
  uri?: string;
  line?: number;
  hash?: string;
}

// A SARIF file shaped like the CodeQL output: the rules are in a query pack.
function sarif(findings: readonly Finding[]): string {
  return JSON.stringify({
    runs: [
      {
        tool: {
          driver: { name: "CodeQL" },
          extensions: [
            {
              name: "codeql/javascript-queries",
              rules: [
                {
                  id: "js/sql-injection",
                  properties: { "security-severity": "8.8" },
                },
                {
                  id: "js/weak-hash",
                  properties: { "security-severity": "5.0" },
                },
                { id: "js/unused-variable", properties: {} },
              ],
            },
          ],
        },
        results: findings.map(
          ({ ruleId, uri = "src/db.ts", line = 10, hash }) => ({
            ruleId,
            rule: { id: ruleId, toolComponent: { index: 0 } },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri },
                  region: { startLine: line },
                },
              },
            ],
            ...(hash === undefined
              ? {}
              : { partialFingerprints: { primaryLocationLineHash: hash } }),
          }),
        ),
      },
    ],
  });
}

describe("severityOf", () => {
  it.each([
    ["9.8", "critical"],
    ["9.0", "critical"],
    ["7.0", "high"],
    ["6.9", "medium"],
    ["4.0", "medium"],
    ["0.1", "low"],
  ] as const)("maps %s to %s", (score, severity) => {
    expect(severityOf(score)).toBe(severity);
  });

  it("treats a rule without a score as a quality rule", () => {
    expect(severityOf(undefined)).toBeUndefined();
    expect(severityOf("0")).toBeUndefined();
    expect(severityOf("n/a")).toBeUndefined();
  });
});

describe("parseAlerts", () => {
  it("reads the severity from the query pack and the location", () => {
    expect(
      parseAlerts(sarif([{ ruleId: "js/sql-injection", hash: "a1" }])),
    ).toEqual([
      {
        key: "js/sql-injection|src/db.ts|a1",
        ruleId: "js/sql-injection",
        severity: "high",
        location: "src/db.ts:10",
      },
    ]);
  });
});

describe("newAlerts", () => {
  const base = parseAlerts(sarif([{ ruleId: "js/sql-injection", hash: "a1" }]));

  it("ignores an alert of the base commit that moved to another line", () => {
    const head = parseAlerts(
      sarif([{ ruleId: "js/sql-injection", hash: "a1", line: 42 }]),
    );
    expect(newAlerts(base, head, "high")).toEqual([]);
  });

  it("reports a new alert at the threshold", () => {
    const head = parseAlerts(
      sarif([
        { ruleId: "js/sql-injection", hash: "a1" },
        { ruleId: "js/sql-injection", hash: "b2", uri: "src/api.ts" },
      ]),
    );
    expect(
      newAlerts(base, head, "high").map((alert) => alert.location),
    ).toEqual(["src/api.ts:10"]);
  });

  it("reports a new alert below the baseline once the repository tightens the threshold", () => {
    const head = parseAlerts(sarif([{ ruleId: "js/weak-hash", hash: "c3" }]));
    expect(newAlerts(base, head, "high")).toEqual([]);
    expect(newAlerts(base, head, "medium")).toHaveLength(1);
  });

  it("ignores quality rules", () => {
    const head = parseAlerts(
      sarif([{ ruleId: "js/unused-variable", hash: "d4" }]),
    );
    expect(newAlerts(base, head, "low")).toEqual([]);
  });
});
