import { describe, expect, it } from "vitest";
import { summarize } from "./session-summary.ts";

const TOKEN = ["sk", "ant", "oat01", "Abc123_def-456ghi789jkl"].join("-");

const RESULT = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 7,
  duration_ms: 51000,
  total_cost_usd: 0.42,
  usage: { input_tokens: 1200, output_tokens: 300 },
  result: `Done. Step 2 printed ${TOKEN}.`,
});

const AUDIT = [
  { decision: "allowed", redactions: 1 },
  { decision: "denied", blocks: [{ category: "secrets" }] },
  { decision: "denied", blocks: [{ category: "network" }] },
  { decision: "denied", blocks: [{ category: "secrets" }] },
]
  .map((record) => JSON.stringify(record))
  .join("\n");

describe("summarize", () => {
  it("reports the result, the usage and the tool calls", () => {
    const summary = summarize(RESULT, AUDIT);
    expect(summary).toContain("- Result: success, error: false");
    expect(summary).toContain("- Turns: 7, duration: 51000 ms");
    expect(summary).toContain("0.42 USD");
    expect(summary).toContain('"input_tokens":1200');
    expect(summary).toContain("- Tool calls: allowed 1, denied 3");
    expect(summary).toContain("- Blocks by category: secrets 2, network 1");
    expect(summary).toContain("- Redactions in tool output: 1");
  });

  it("redacts the final message", () => {
    const summary = summarize(RESULT, AUDIT);
    expect(summary).toContain("Done. Step 2 printed [REDACTED].");
    expect(summary).not.toContain(TOKEN);
  });

  it("summarizes a session that left no files", () => {
    const summary = summarize("", "");
    expect(summary).toContain("- Result: unknown");
    expect(summary).toContain("- Tool calls: none");
  });
});
