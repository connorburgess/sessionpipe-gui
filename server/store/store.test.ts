// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DONE_AFTER_MS, SNIPPET_CHARS, STALE_AFTER_MS, type StreamMessage, sessionKey } from "../../shared/api.js";
import { Session, SID, tempDir } from "../../test/events.js";
import { Store } from "./store.js";

const KEY = sessionKey("claude-code", SID);
let tmp: { dir: string; cleanup: () => void };
let store: Store;

beforeEach(() => {
  tmp = tempDir();
  store = new Store(tmp.dir, { tickMs: 1_000, statsMs: 1_000 });
});
afterEach(async () => {
  await store.close();
  tmp.cleanup();
  vi.useRealTimers();
});

describe("ingest", () => {
  it("files events, dedups on (harness, session, seq) within and across batches", () => {
    const s = new Session();
    const a = s.ev("session.started", { source: "startup" });
    const b = s.ev("turn.started", { turn_id: "t1" });
    const r1 = store.ingest([a, b, { ...b }], "http");
    expect(r1).toMatchObject({ accepted: 2, duplicates: 1, rejected: [] });
    expect(r1.stored).toHaveLength(2);
    expect(r1.stored[0]).toMatchObject({ source: "http", type: "session.started" });
    expect(store.ingest([a], "outbox")).toMatchObject({ accepted: 0, duplicates: 1 });
    const other = new Session(SID, "codex");
    expect(store.ingest([other.ev("session.started", {}, { seq: 0 })], "http").accepted).toBe(1);
    expect(store.snapshot().sessions).toHaveLength(2);
    const file = path.join(tmp.dir, "events", "claude-code", `${SID}.jsonl`);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("rejects what it cannot file, never the batch", () => {
    const s = new Session();
    const bad = { ...s.ev("tool.ended"), session: { id: "", seq: 1 } };
    const r = store.ingest([bad, s.ev("session.started")], "http");
    expect(r.accepted).toBe(1);
    expect(r.rejected).toEqual([{ id: bad.id, reason: "bad_session" }]);
  });
});

describe("coalesce", () => {
  it("keeps full values over empty ones and the better title source", () => {
    const s = new Session();
    store.ingest(
      [
        s.ev(
          "session.started",
          {},
          { session: { title: "first ask", title_source: "first-ask", branch: "main", model: "m1" } },
        ),
      ],
      "http",
    );
    store.ingest([s.ev("turn.started", {}, { session: { branch: "", model: undefined, title: "" } })], "http");
    let sum = store.session(KEY)!;
    expect(sum).toMatchObject({ branch: "main", model: "m1", title: "first ask", titleSource: "first-ask" });
    store.ingest(
      [s.ev("tool.started", { tool: "Bash" }, { session: { title: "Harness title", title_source: "harness" } })],
      "http",
    );
    sum = store.session(KEY)!;
    expect(sum).toMatchObject({ title: "Harness title", titleSource: "harness" });
    store.ingest(
      [s.ev("tool.ended", { tool: "Bash", ok: true }, { session: { title: "worse", title_source: "first-ask" } })],
      "http",
    );
    expect(store.session(KEY)!.title).toBe("Harness title");
    store.ingest(
      [s.ev("turn.ended", { reason: "stop" }, { session: { title: "Mine", title_source: "custom" } })],
      "http",
    );
    expect(store.session(KEY)).toMatchObject({ title: "Mine", titleSource: "custom", harnessVersion: "2.1.296" });
  });
});

describe("readings", () => {
  it("tracks turns, tools, the current tool and recent tools", () => {
    const s = new Session();
    store.ingest([s.ev("session.started", { source: "startup" })], "http");
    expect(store.session(KEY)!.state).toBe("idle");
    store.ingest([s.ev("turn.started", { turn_id: "t1", prompt_chars: 42 })], "http");
    let sum = store.session(KEY)!;
    expect(sum.state).toBe("working");
    expect(sum.currentTurn).toMatchObject({ turnId: "t1", promptChars: 42 });
    store.ingest([s.ev("tool.started", { tool: "Bash", call_id: "c1" })], "http");
    expect(store.session(KEY)!.currentTool).toMatchObject({ tool: "Bash", callId: "c1" });
    store.ingest([s.ev("tool.ended", { tool: "Bash", call_id: "other", ok: true, ms: 5 })], "http");
    expect(store.session(KEY)!.currentTool?.callId).toBe("c1");
    store.ingest([s.ev("tool.ended", { tool: "Bash", call_id: "c1", ok: false, ms: 10 })], "http");
    sum = store.session(KEY)!;
    expect(sum.currentTool).toBeUndefined();
    expect(sum.counts).toMatchObject({ tools: 2, toolErrors: 1, turns: 1 });
    store.ingest([s.ev("tool.started", { tool: "Read" })], "http");
    store.ingest([s.ev("tool.ended", { tool: "Read", ok: true })], "http");
    expect(store.session(KEY)!.currentTool).toBeUndefined();
    store.ingest([s.ev("tool.started", { tool: "Edit" })], "http");
    store.ingest([s.ev("turn.ended", { reason: "stop" })], "http");
    sum = store.session(KEY)!;
    expect(sum.currentTool).toBeUndefined();
    expect(sum.currentTurn).toBeUndefined();
    expect(sum.state).toBe("idle");
    for (let i = 0; i < 10; i++) store.ingest([s.ev("tool.ended", { tool: `T${i}`, ok: true })], "http");
    sum = store.session(KEY)!;
    expect(sum.recentTools).toHaveLength(8);
    expect(sum.recentTools[7]).toEqual({ tool: "T9", ok: true });
  });

  it("counts files, subagents, compactions and children", () => {
    const s = new Session();
    store.ingest(
      [
        s.ev("session.started"),
        s.ev("files.changed", { paths: ["a.ts", "b.ts"] }),
        s.ev("files.changed", { paths: ["a.ts"] }),
        s.ev("subagent.started", { agent_id: "ag1" }),
        s.ev("context.compacted", { trigger: "auto" }),
      ],
      "http",
    );
    expect(store.session(KEY)!.counts).toMatchObject({ filesChanged: 2, subagents: 1, compactions: 1, events: 5 });
    const child = new Session("child-1");
    store.ingest([child.ev("session.started", {}, { session: { parent_id: SID } })], "http");
    expect(store.session(KEY)!.children).toBe(1);
    expect(store.session(sessionKey("claude-code", "child-1"))!.parentId).toBe(SID);
    // A child that arrives before its parent still counts once the parent shows up.
    const orphan = new Session("child-of-later");
    store.ingest([orphan.ev("session.started", {}, { session: { parent_id: "later" } })], "http");
    store.ingest([new Session("later").ev("session.started")], "http");
    expect(store.session(sessionKey("claude-code", "later"))!.children).toBe(1);
    expect(store.sessionDetail(sessionKey("claude-code", "later"))!.children.map((c) => c.id)).toEqual([
      "child-of-later",
    ]);
  });

  it("keeps progress until its transcript or the turn's end; snippets are cut", () => {
    const s = new Session();
    store.ingest([s.ev("session.started"), s.ev("turn.started", { turn_id: "t1" })], "http");
    store.ingest(
      [s.ev("turn.progress", { turn: 3, user: "hi", assistant: "so far", at: "2026-10-14T10:00:05.000Z" })],
      "http",
    );
    expect(store.session(KEY)!.progress).toMatchObject({ turn: 3, user: "hi", assistant: "so far" });
    store.ingest([s.ev("turn.transcript", { turn: 2, user: "old", assistant: "old", at: "x" })], "http");
    expect(store.session(KEY)!.progress?.turn).toBe(3);
    const long = "x".repeat(1000);
    store.ingest([s.ev("turn.transcript", { turn: 3, user: long, assistant: `${long}!`, at: "x" })], "http");
    const sum = store.session(KEY)!;
    expect(sum.progress).toBeUndefined();
    expect(sum.lastUser).toHaveLength(SNIPPET_CHARS);
    expect(sum.lastAssistant).toHaveLength(SNIPPET_CHARS);
    store.ingest([s.ev("turn.progress", { turn: 4, user: "u", assistant: "a", at: "x" })], "http");
    expect(store.session(KEY)!.progress?.turn).toBe(4);
    store.ingest([s.ev("turn.ended", { reason: "stop" })], "http");
    expect(store.session(KEY)!.progress).toBeUndefined();
  });

  it("opens an attention until attention.cleared or the session's next hook event", () => {
    const s = new Session();
    store.ingest([s.ev("session.started"), s.ev("turn.started")], "http");
    store.ingest(
      [s.ev("attention.needed", { attention_id: "p1", kind: "permission", tool: "Bash", message: "rm -rf" })],
      "http",
    );
    let sum = store.session(KEY)!;
    expect(sum.state).toBe("needs_you");
    expect(sum.openAttentions).toEqual([
      { attentionId: "p1", kind: "permission", tool: "Bash", message: "rm -rf", at: expect.any(String) },
    ]);
    expect(sum.counts.attentions).toBe(1);
    // Worker-derived events do not prove the harness moved on.
    store.ingest([s.ev("turn.progress", { turn: 1, user: "u", assistant: "a", at: "x" })], "http");
    expect(store.session(KEY)!.state).toBe("needs_you");
    store.ingest([s.ev("attention.cleared", { attention_id: "p1", how: "answered" })], "http");
    sum = store.session(KEY)!;
    expect(sum.openAttentions).toEqual([]);
    expect(sum.state).toBe("working");
    store.ingest([s.ev("attention.needed", { attention_id: "p2", kind: "question" })], "http");
    expect(store.session(KEY)!.state).toBe("needs_you");
    store.ingest([s.ev("tool.started", { tool: "Bash" })], "http");
    sum = store.session(KEY)!;
    expect(sum.openAttentions).toEqual([]);
    expect(sum.state).toBe("working");
    expect(sum.counts.attentions).toBe(2);
  });

  it("is done on session.ended and for a backfill-only session", () => {
    const s = new Session();
    store.ingest([s.ev("session.started"), s.ev("turn.started"), s.ev("session.ended", { reason: "exit" })], "http");
    const sum = store.session(KEY)!;
    expect(sum.state).toBe("done");
    expect(sum.endedAt).toBeDefined();
    expect(sum.currentTurn).toBeUndefined();
    const b = new Session("old-one");
    store.ingest(
      [
        b.ev(
          "session.backfill",
          { started_at: "2026-09-01T00:00:00.000Z", last_at: "2026-09-02T00:00:00.000Z", turns: 7 },
          { seq: 0 },
        ),
      ],
      "outbox",
    );
    const back = store.session(sessionKey("claude-code", "old-one"))!;
    expect(back).toMatchObject({
      state: "done",
      backfilled: true,
      startedAt: "2026-09-01T00:00:00.000Z",
      lastAt: "2026-09-02T00:00:00.000Z",
      source: "outbox",
    });
    expect(back.counts.turns).toBe(7);
    store.ingest([b.ev("session.started", { source: "resume" })], "outbox");
    expect(store.session(sessionKey("claude-code", "old-one"))!.backfilled).toBe(false);
  });

  it("goes stale and then done on the timers, emitting session messages", async () => {
    await store.close();
    vi.useFakeTimers();
    const t0 = Date.parse("2026-10-14T12:00:00.000Z");
    vi.setSystemTime(t0);
    store = new Store(tmp.dir, { tickMs: 1_000 });
    const got: StreamMessage[] = [];
    store.subscribe((m) => got.push(m));
    const s = new Session();
    s.clock = t0 - 2_000;
    store.ingest([s.ev("session.started"), s.ev("turn.started", { turn_id: "t1" })], "http");
    expect(store.session(KEY)!.state).toBe("working");
    vi.advanceTimersByTime(STALE_AFTER_MS - 5_000);
    expect(got.filter((m) => m.kind === "session")).toHaveLength(0);
    vi.advanceTimersByTime(10_000);
    const stale = got.filter((m) => m.kind === "session");
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ kind: "session", session: { state: "stale" } });
    vi.advanceTimersByTime(DONE_AFTER_MS);
    const done = got.filter((m) => m.kind === "session");
    expect(done[done.length - 1]).toMatchObject({ session: { state: "done" } });
    // An idle session is also done after DONE_AFTER_MS of silence.
    const s2 = new Session("quiet");
    s2.clock = Date.now();
    store.ingest([s2.ev("session.started"), s2.ev("turn.started"), s2.ev("turn.ended", { reason: "stop" })], "http");
    expect(store.session(sessionKey("claude-code", "quiet"))!.state).toBe("idle");
    vi.advanceTimersByTime(DONE_AFTER_MS + 1_000);
    expect(store.session(sessionKey("claude-code", "quiet"))!.state).toBe("done");
  });
});

describe("forget", () => {
  it("deletes the file and the index entry and emits forgotten", () => {
    const s = new Session();
    store.ingest([s.ev("session.started"), s.ev("turn.started")], "http");
    const file = path.join(tmp.dir, "events", "claude-code", `${SID}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const got: StreamMessage[] = [];
    store.subscribe((m) => got.push(m));
    expect(store.ingest([s.ev("session.forgotten")], "http")).toMatchObject({ accepted: 1, stored: [] });
    expect(existsSync(file)).toBe(false);
    expect(store.session(KEY)).toBeUndefined();
    expect(store.feed().events).toHaveLength(0);
    expect(got).toContainEqual({ kind: "forgotten", key: KEY });
    expect(store.stats()).toMatchObject({ events: 0, sessions: 0, storageBytes: 0 });
    expect(store.forget(KEY)).toBe(false);
  });
});

describe("detail and feed", () => {
  it("pages a session's events by seq, reading the full data from disk", () => {
    const s = new Session();
    const big = "y".repeat(10_000);
    const events = [s.ev("session.started")];
    for (let i = 0; i < 5; i++)
      events.push(s.ev("tool.ended", { tool: "Bash", ok: true, input: { command: big }, output: big }));
    store.ingest(events, "http");
    const p1 = store.sessionDetail(KEY, undefined, 3)!;
    expect(p1.total).toBe(6);
    expect(p1.events.map((e) => e.session.seq)).toEqual([0, 1, 2]);
    expect(p1.events[1]!.data.output).toBe(big);
    expect((p1.events[1]!.data.input as { command: string }).command).toBe(big);
    expect("preview" in p1.events[1]!).toBe(false);
    const p2 = store.sessionDetail(KEY, 2, 10)!;
    expect(p2.events.map((e) => e.session.seq)).toEqual([3, 4, 5]);
    // The feed and the stream carry the slim copy.
    const slim = store.feed({ session: KEY, type: "tool.ended" }).events[0]!;
    expect((slim.data.output as string).length).toBe(2048);
    expect((slim as { preview?: Record<string, number> }).preview).toEqual({
      input: JSON.stringify({ command: big }).length,
      output: 10_000,
    });
    expect(store.sessionDetail("claude-code:nope")).toBeUndefined();
  });

  it("feeds newest first with a cursor and filters", () => {
    const a = new Session("a");
    const b = new Session("b", "codex");
    store.ingest([a.ev("session.started", {}, { session: { title: "Alpha work" } })], "http");
    store.ingest([b.ev("session.started", {}, { session: { machine: "box-2" } })], "http");
    for (let i = 0; i < 5; i++) store.ingest([a.ev("tool.ended", { tool: i % 2 ? "Bash" : "Read", ok: true })], "http");
    store.ingest(
      [
        b.ev(
          "turn.transcript",
          { turn: 0, user: "find the needle please", assistant: "ok", at: "x" },
          { session: { machine: "box-2" } },
        ),
      ],
      "http",
    );
    const all = store.feed({ limit: 3 });
    expect(all.events).toHaveLength(3);
    expect(all.events[0]!.type).toBe("turn.transcript");
    expect(all.cursor).toBeDefined();
    const next = store.feed({ limit: 3, before: all.cursor });
    expect(next.events).toHaveLength(3);
    expect(next.events.every((e) => e.type === "tool.ended")).toBe(true);
    const rest = store.feed({ limit: 10, before: next.cursor });
    expect(rest.events.map((e) => e.type)).toEqual(["session.started", "session.started"]);
    expect(rest.cursor).toBeUndefined();
    expect(store.feed({ harness: "codex" }).events).toHaveLength(2);
    expect(store.feed({ machine: "box-2" }).events).toHaveLength(2);
    expect(store.feed({ type: "tool.ended" }).events).toHaveLength(5);
    expect(store.feed({ session: "claude-code:a" }).events).toHaveLength(6);
    expect(store.feed({ q: "bash" }).events).toHaveLength(2);
    expect(store.feed({ q: "needle" }).events).toHaveLength(1);
    expect(store.feed({ q: "alpha" }).events).toHaveLength(6);
  });
});

describe("machines and stats", () => {
  it("summarises machines and measures http latency", () => {
    const a = new Session("a");
    const b = new Session("b", "codex");
    const now = Date.now();
    store.ingest(
      [a.ev("session.started", {}, { time: new Date(now - 300).toISOString() }), a.ev("turn.started")],
      "http",
    );
    store.ingest([b.ev("session.started", {}, { session: { machine: "box-2" }, version: "0.9" })], "outbox");
    const ms = store.machines();
    expect(ms.map((m) => m.name).sort()).toEqual(["box-2", "misha-air"]);
    expect(ms.find((m) => m.name === "misha-air")).toMatchObject({
      sessions: 1,
      working: 1,
      harnesses: { "claude-code": "2.1.296" },
    });
    expect(ms.find((m) => m.name === "box-2")).toMatchObject({ harnesses: { codex: "0.9" } });
    const st = store.stats();
    expect(st).toMatchObject({ events: 3, sessions: 2, machines: 2, eventsLastMinute: 3 });
    expect(st.latencyP50Ms).toBeGreaterThanOrEqual(0);
    expect(st.storageBytes).toBeGreaterThan(0);
  });

  it("emits event, machine and stats messages", async () => {
    await store.close();
    vi.useFakeTimers();
    store = new Store(tmp.dir, { statsMs: 1_000 });
    const got: StreamMessage[] = [];
    store.subscribe((m) => got.push(m));
    const s = new Session();
    store.ingest([s.ev("session.started")], "http");
    expect(got.map((m) => m.kind)).toEqual(["event", "machine"]);
    expect(got[0]).toMatchObject({ kind: "event", event: { type: "session.started" }, session: { key: KEY } });
    vi.advanceTimersByTime(1_100);
    expect(got.at(-1)).toMatchObject({ kind: "stats", stats: { events: 1 } });
  });
});

describe("reboot", () => {
  it("rebuilds the same index from the files", async () => {
    const s = new Session();
    const t = new Session("two", "codex");
    // Arrival order across sessions is kept by arrivedAt, so let the batches land in different ms.
    const pause = () => new Promise((r) => setTimeout(r, 3));
    store.ingest(
      [s.ev("session.started", {}, { session: { title: "T", title_source: "harness" } }), s.ev("turn.started")],
      "http",
    );
    await pause();
    store.ingest(
      [t.ev("session.backfill", { started_at: "2026-09-01T00:00:00.000Z", last_at: "2026-09-02T00:00:00.000Z" })],
      "outbox",
    );
    await pause();
    store.ingest(
      [
        s.ev("tool.started", { tool: "Bash", call_id: "c" }),
        s.ev("attention.needed", { attention_id: "p", kind: "permission" }),
      ],
      "http",
    );
    const before = store.snapshot();
    const feedBefore = store.feed().events.map((e) => e.id);
    await store.close();
    store = new Store(tmp.dir);
    const after = store.snapshot();
    expect(after.sessions).toEqual(before.sessions);
    expect(after.stats).toMatchObject({ events: 5, sessions: 2, storageBytes: before.stats.storageBytes });
    expect(store.feed().events.map((e) => e.id)).toEqual(feedBefore);
    expect(store.ingest([s.ev("turn.ended", {}, { seq: 1 })], "http").duplicates).toBe(1);
    const detail = store.sessionDetail(KEY)!;
    expect(detail.events.map((e) => e.session.seq)).toEqual([0, 1, 2, 3]);
    expect(detail.events[0]!.arrivedAt).toBeDefined();
  });
});
