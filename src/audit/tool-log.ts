import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// One agent tool call in the audit log (NFR-9.11). The input is a short,
// redacted summary: the log never holds a whole transcript (plan 4).
export interface ToolCallRecord {
  time: string;
  session: string;
  role: string;
  tool: string;
  input: string;
  decision: "allowed" | "denied" | "failed";
  blocks?: { policy: string; category: string; reason: string }[];
  duration_ms?: number;
  redactions?: number;
}

export interface ToolCallLog {
  append(record: ToolCallRecord): Promise<void>;
}

// Appends one JSON object per line. Hooks of parallel tool calls append at the
// same time, and each record is a single short write.
export class JsonlToolCallLog implements ToolCallLog {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async append(record: ToolCallRecord): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(record)}\n`);
  }
}
