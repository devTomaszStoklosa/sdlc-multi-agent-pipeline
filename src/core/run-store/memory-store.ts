import type { RunRecord } from "./run-record.ts";
import {
  nextRevision,
  type RunStateStore,
  type StoredRecord,
  type WriteResult,
} from "./store.ts";

// An in-memory store for tests, with the same revision check as the comment.
export class MemoryRunStateStore implements RunStateStore {
  private readonly records = new Map<number, StoredRecord>();
  private readonly clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  read(issue: number): Promise<StoredRecord | undefined> {
    return Promise.resolve(this.records.get(issue));
  }

  write(record: RunRecord, expected: number | undefined): Promise<WriteResult> {
    const current = this.records.get(record.issue);
    if (current?.record.revision !== expected) {
      return Promise.resolve({ ok: false, current });
    }
    const stored: StoredRecord = {
      record: structuredClone({ ...record, revision: nextRevision(expected) }),
      url: `memory://issues/${String(record.issue)}#state`,
      updatedAt: this.clock().toISOString(),
    };
    this.records.set(record.issue, stored);
    return Promise.resolve({ ok: true, stored });
  }
}
