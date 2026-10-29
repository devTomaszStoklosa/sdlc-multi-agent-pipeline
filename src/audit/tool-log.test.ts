import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlToolCallLog, type ToolCallRecord } from "./tool-log.ts";

const RECORD: ToolCallRecord = {
  time: "2026-10-29T10:00:00.000Z",
  session: "s1",
  role: "developer",
  tool: "Bash",
  input: "npm test",
  decision: "allowed",
  duration_ms: 1200,
};

describe("JsonlToolCallLog", () => {
  it("appends one JSON line per record and creates the directory", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tool-log-"));
    const file = path.join(directory, "audit", "tool-calls.jsonl");
    const log = new JsonlToolCallLog(file);
    await log.append(RECORD);
    await log.append({ ...RECORD, decision: "denied" });
    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      RECORD,
      { ...RECORD, decision: "denied" },
    ]);
  });
});
