import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// One event of a run (NFR-11.3): a stage, a transition, a check before a side
// effect (FR-4.28c), a side effect, an ignored event or a stop. Each job of a
// workflow run writes its own JSONL file, which the job uploads as an
// artifact (plan 7.4, NFR-11.1 in the MVP).
const runEventSchema = z.looseObject({
  time: z.string(),
  type: z.string(),
  issue: z.number(),
  run: z.string().optional(),
  pr: z.number().optional(),
  stage: z.string().optional(),
  agent: z.string().optional(),
  workflow_run: z.number().optional(),
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
  result: z.string().optional(),
  round: z.number().optional(),
  tokens: z.object({ input: z.number(), output: z.number() }).optional(),
  cost_usd: z.number().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type RunEventRecord = z.infer<typeof runEventSchema>;

export interface RunEventLog {
  append(record: RunEventRecord): Promise<void>;
}

export class JsonlRunEventLog implements RunEventLog {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async append(record: RunEventRecord): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(record)}\n`);
  }
}

export class MemoryRunEventLog implements RunEventLog {
  readonly records: RunEventRecord[] = [];

  append(record: RunEventRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

// Reads the events of a JSONL file. A line that is not an event is skipped,
// because a job cancelled during a write may leave half a line.
export function parseRunEvents(text: string): RunEventRecord[] {
  return text.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const parsed = runEventSchema.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}
