import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlRunEventLog, parseRunEvents } from "./run-events.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("JsonlRunEventLog", () => {
  it("appends one event per line and parses them back", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "run-events-"));
    dirs.push(dir);
    const file = path.join(dir, "nested", "events.jsonl");
    const log = new JsonlRunEventLog(file);
    await log.append({ time: "t1", type: "transition", issue: 1 });
    await log.append({ time: "t2", type: "side-effect", issue: 1, run: "1-1" });
    const events = parseRunEvents(await readFile(file, "utf8"));
    expect(events.map((event) => event.type)).toEqual([
      "transition",
      "side-effect",
    ]);
  });
});

describe("parseRunEvents", () => {
  it("skips a half-written line and lines that are not events", () => {
    const text = [
      JSON.stringify({ time: "t1", type: "stage", issue: 2 }),
      '{"time":"t2","ty',
      JSON.stringify({ hello: "world" }),
      "",
    ].join("\n");
    expect(parseRunEvents(text)).toEqual([
      { time: "t1", type: "stage", issue: 2 },
    ]);
  });
});
