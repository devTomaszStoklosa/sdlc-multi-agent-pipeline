import type { RunRecord } from "./run-record.ts";

export interface StoredRecord {
  record: RunRecord;
  // Where the record lives, e.g. the URL of the state comment.
  url: string;
  // The server time of the last write.
  updatedAt: string;
}

export type WriteResult =
  | { ok: true; stored: StoredRecord }
  | { ok: false; current: StoredRecord | undefined };

// The state of an issue's runs outside the agent sessions (FR-4.29). A write
// succeeds only when the stored revision still equals the expected one, so a
// writer that read an older state recomputes instead of overwriting a newer
// one (plan 9).
export interface RunStateStore {
  read(issue: number): Promise<StoredRecord | undefined>;
  // `expected` is undefined when the issue has no record yet.
  write(record: RunRecord, expected: number | undefined): Promise<WriteResult>;
}

export class StateConflictError extends Error {
  constructor(issue: number) {
    super(`The run state of issue #${String(issue)} changed during the write.`);
    this.name = "StateConflictError";
  }
}

// The revision a write stores.
export function nextRevision(expected: number | undefined): number {
  return expected === undefined ? 0 : expected + 1;
}
