import { describe, expect, it } from "vitest";
import { FakeGitHub } from "../../github/fake.ts";
import { decodeRecord, encodeRecord } from "./codec.ts";
import { CommentRunStateStore } from "./comment-store.ts";
import { MemoryRunStateStore } from "./memory-store.ts";
import { newRunRecord, withProgress, type RunRecord } from "./run-record.ts";
import type { RunStateStore } from "./store.ts";

const NOW = new Date("2026-10-29T10:00:00Z");

function record(issue = 1, configText = "version: 1\n"): RunRecord {
  return newRunRecord(
    {
      issue,
      startedBy: "author",
      config: { sha: "abcdef0", text: configText },
      labels: {
        ready: "agent:ready",
        needs_human: "needs-human",
        plan_approved: "plan:approved",
      },
      workflowRunId: 5,
      now: NOW,
    },
    undefined,
  );
}

describe("encodeRecord and decodeRecord", () => {
  it("keep the record, also when the configuration could end the HTML comment", () => {
    const original = record(1, "# --> -- ---\nversion: 1\n");
    const body = encodeRecord(original);
    expect(body.split("-->")).toHaveLength(2);
    expect(decodeRecord(body)).toEqual({
      found: true,
      ok: true,
      record: original,
    });
  });

  it("show the state in the visible part of the comment", () => {
    expect(encodeRecord(record())).toMatch(/`queued` \(przebieg 1-1\)/);
  });

  it("find no state in an ordinary comment", () => {
    expect(decodeRecord("Looks good.")).toEqual({ found: false });
  });

  it("reject a record of another schema version", () => {
    const body = encodeRecord(record()).replace('"schema":1', '"schema":2');
    expect(decodeRecord(body)).toMatchObject({ found: true, ok: false });
  });
});

describe("newRunRecord", () => {
  it("numbers the runs of an issue and keeps the earlier ones", () => {
    const first = record();
    const stopped = {
      ...first,
      run: withProgress(
        first.run,
        { ...first.run.progress, state: "stopped" },
        NOW,
      ),
    };
    const second = newRunRecord(
      {
        issue: 1,
        startedBy: "author",
        config: first.run.config,
        labels: first.run.labels,
        workflowRunId: 9,
        now: NOW,
      },
      stopped,
    );
    expect(second.run.id).toBe("1-2");
    expect(second.run.progress.state).toBe("queued");
    expect(second.previousRuns).toEqual([{ id: "1-1", state: "stopped" }]);
  });
});

describe("withProgress", () => {
  it("adds only a change of state to the history", () => {
    const { run } = record();
    const later = new Date("2026-10-29T10:05:00Z");
    const same = withProgress(run, { ...run.progress, reviewRound: 1 }, later);
    expect(same.history).toHaveLength(1);
    const moved = withProgress(
      run,
      { ...run.progress, state: "planning" },
      later,
    );
    expect(moved.history.at(-1)).toEqual({
      state: "planning",
      at: "2026-10-29T10:05:00.000Z",
    });
  });
});

function stores(): [
  string,
  () => { store: RunStateStore; github?: FakeGitHub },
][] {
  return [
    ["memory", () => ({ store: new MemoryRunStateStore(() => NOW) })],
    [
      "comment",
      () => {
        const github = new FakeGitHub(() => NOW);
        github.addIssue(1);
        return {
          store: new CommentRunStateStore(github, github.appId),
          github,
        };
      },
    ],
  ];
}

describe.each(stores())("the %s store", (_name, create) => {
  it("writes a new record and reads it back", async () => {
    const { store } = create();
    const result = await store.write(record(), undefined);
    expect(result.ok).toBe(true);
    expect((await store.read(1))?.record.revision).toBe(0);
  });

  it("increases the revision on each write", async () => {
    const { store } = create();
    await store.write(record(), undefined);
    const result = await store.write(record(), 0);
    expect(result).toMatchObject({
      ok: true,
      stored: { record: { revision: 1 } },
    });
  });

  it("refuses a write based on an older revision", async () => {
    const { store } = create();
    await store.write(record(), undefined);
    await store.write(record(), 0);
    const result = await store.write(record(), 0);
    expect(result).toMatchObject({
      ok: false,
      current: { record: { revision: 1 } },
    });
  });

  it("refuses to create a record that already exists", async () => {
    const { store } = create();
    await store.write(record(), undefined);
    expect((await store.write(record(), undefined)).ok).toBe(false);
  });
});

describe("CommentRunStateStore", () => {
  it("ignores a state comment written by anybody but the app", async () => {
    const github = new FakeGitHub(() => NOW);
    github.addIssue(1);
    github.commentAppId = undefined;
    await github.createComment(1, encodeRecord(record()));
    const store = new CommentRunStateStore(github, github.appId);
    expect(await store.read(1)).toBeUndefined();
  });

  it("fails on a state comment of the app that does not match the schema", async () => {
    const github = new FakeGitHub(() => NOW);
    github.addIssue(1);
    await github.createComment(1, "<!-- sdlc-run-state\n{}\n-->");
    const store = new CommentRunStateStore(github, github.appId);
    await expect(store.read(1)).rejects.toThrow(/Invalid run state/);
  });

  it("notices that another writer overwrote its write", async () => {
    const github = new FakeGitHub(() => NOW);
    github.addIssue(1);
    const store = new CommentRunStateStore(github, github.appId);
    await store.write(record(), undefined);
    const update = github.updateComment.bind(github);
    // Another writer with the same expected revision writes right after.
    github.updateComment = async (id, body) => {
      const written = await update(id, body);
      const other = {
        ...record(),
        run: { ...record().run, startedBy: "other" },
      };
      await update(id, encodeRecord({ ...other, revision: 1 }));
      return written;
    };
    const result = await store.write(record(), 0);
    expect(result).toMatchObject({
      ok: false,
      current: { record: { run: { startedBy: "other" } } },
    });
  });
});
