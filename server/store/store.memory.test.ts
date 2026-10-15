// SPDX-License-Identifier: Apache-2.0
// The index must stay light: boot on a generated 10 000-event store (tool inputs and
// outputs of several KB, transcripts, fifty sessions, a third of it older than
// keepDays) and hold the heap to a budget per event. The full events stay on disk.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StoredEvent, StreamMessage } from "../../shared/api.js";
import { Session, tempDir } from "../../test/events.js";
import { safeName } from "./files.js";
import { PREVIEW_CHARS } from "./slim.js";
import { OLD_PREVIEW_CHARS, Store } from "./store.js";

const SESSIONS = 50;
const EVENTS = 10_000;
/** Heap bytes the index may hold per event, measured after a full GC. The owner's real
 *  store (11k events, 182 MB of JSONL) comes to ~3.5 KB/event; this fixture has bigger
 *  strings on every event than real traffic does. */
const BUDGET_PER_EVENT = 4 * 1024;

const text = (n: number, seed: number): string => {
  let s = "";
  while (s.length < n) s += `line ${seed} of a tool's output, long enough to be cut to a preview in memory\n`;
  return s.slice(0, n);
};

/** A full GC without --expose-gc on the command line. */
const gc = (): void => {
  setFlagsFromString("--expose-gc");
  (runInNewContext("gc") as () => void)();
  setFlagsFromString("--no-expose-gc");
};

let tmp: { dir: string; cleanup: () => void };
let bytesOnDisk = 0;

beforeAll(() => {
  tmp = tempDir("spgui-mem-");
  const now = Date.now();
  const perSession = EVENTS / SESSIONS;
  for (let i = 0; i < SESSIONS; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    // Sessions 0–15 ran twenty days ago (past keepDays); the rest this hour.
    const old = i < SESSIONS / 3;
    const start = old ? now - 20 * 86_400_000 : now - 3_600_000 + i * 1000;
    const s = new Session(id, i % 2 ? "codex" : "claude-code", start);
    const lines: string[] = [];
    for (let n = 0; n < perSession; n++) {
      const step = n % 8;
      const ev =
        step === 0
          ? s.ev("turn.started", { turn_id: `t${n}`, prompt_chars: 1400, user: text(1400, n) })
          : step === 7
            ? s.ev("turn.transcript", { turn: n >> 3, user: text(1400, n), assistant: text(5000, n) })
            : step % 2
              ? s.ev("tool.started", {
                  tool: "Read",
                  call_id: `c${n}`,
                  input: { file_path: `/src/${n}.ts`, text: text(1500, n) },
                })
              : s.ev("tool.ended", { tool: "Read", call_id: `c${n - 1}`, ok: true, ms: 120, output: text(6000, n) });
      const stored: StoredEvent = { ...ev, arrivedAt: new Date(s.clock + 20).toISOString(), source: "outbox" };
      lines.push(JSON.stringify(stored));
    }
    const file = path.join(tmp.dir, "events", safeName(s.harness), `${safeName(id)}.jsonl`);
    mkdirSync(path.dirname(file), { recursive: true });
    const body = `${lines.join("\n")}\n`;
    writeFileSync(file, body);
    bytesOnDisk += Buffer.byteLength(body);
  }
});
afterAll(() => tmp.cleanup());

describe("index memory", () => {
  it(`boots ${EVENTS} events under ${BUDGET_PER_EVENT} heap bytes each, with nothing but the index kept`, async () => {
    gc();
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const store = new Store(tmp.dir, { tickMs: 60_000, statsMs: 60_000 });
    const bootMs = performance.now() - t0;
    gc();
    const held = process.memoryUsage().heapUsed - before;
    const perEvent = held / EVENTS;
    const stats = store.stats();
    expect(stats.events).toBe(EVENTS);
    expect(stats.sessions).toBe(SESSIONS);
    expect(stats.storageBytes).toBe(bytesOnDisk);
    console.log(
      `[memory] ${EVENTS} events, ${(bytesOnDisk / 1048576).toFixed(1)} MB on disk → ${(held / 1048576).toFixed(1)} MB heap, ${Math.round(perEvent)} B/event, boot ${Math.round(bootMs)} ms`,
    );
    expect(perEvent, `${Math.round(perEvent)} B/event`).toBeLessThan(BUDGET_PER_EVENT);

    // The slim copies are what the feed serves; old events keep a shorter preview, recent ones the full one.
    const feed = store.feed({ limit: 500 });
    const recent = feed.events.find((e) => e.type === "tool.ended")!;
    expect((recent.data.output as string).length).toBe(PREVIEW_CHARS);
    expect(recent.preview?.output).toBe(6000);
    const oldKey = store.keys().find((k) => k.endsWith("000000000000"))!;
    const old = store.sessionDetail(oldKey, undefined, 10, { slim: true })!;
    const oldEnded = old.events.find((e) => e.type === "tool.ended")!;
    expect((oldEnded.data.output as string).length).toBe(OLD_PREVIEW_CHARS);
    expect(oldEnded.preview?.output).toBe(6000);
    // And the whole event is still one read away.
    const full = store.sessionDetail(oldKey, undefined, 10)!;
    expect((full.events.find((e) => e.type === "tool.ended")!.data.output as string).length).toBe(6000);
    await store.close();
  }, 60_000);

  it("a burst of events is one machine frame a second later, not one per event", async () => {
    const dir = tempDir("spgui-frames-");
    const store = new Store(dir.dir, { tickMs: 60_000, statsMs: 60_000 });
    const frames: StreamMessage[] = [];
    store.subscribe((m) => frames.push(m));
    const s = new Session();
    store.ingest([s.ev("session.started", { source: "startup" })], "http");
    // The first sight of the machine goes out at once.
    expect(frames.filter((m) => m.kind === "machine")).toHaveLength(1);
    // The first tool makes the session `working`: a change beyond lastAt, out at once.
    store.ingest([s.ev("tool.started", { tool: "Read", call_id: "c0" })], "http");
    expect(frames.filter((m) => m.kind === "machine")).toHaveLength(2);
    expect(frames[frames.length - 1]).toMatchObject({ kind: "machine", machine: { name: "misha-air", working: 1 } });
    // Twenty more events move only lastAt: no frame until the flush, then one.
    for (let i = 1; i <= 20; i++)
      store.ingest([s.ev("tool.ended", { tool: "Read", call_id: `c${i}`, ok: true })], "http");
    expect(frames.filter((m) => m.kind === "event")).toHaveLength(22);
    expect(frames.filter((m) => m.kind === "machine")).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 1200));
    const machines = frames.filter((m) => m.kind === "machine");
    expect(machines).toHaveLength(3);
    expect(machines[2]).toMatchObject({ machine: { name: "misha-air", lastAt: store.snapshot().machines[0]!.lastAt } });
    await store.close();
    dir.cleanup();
  });

  it("keepDays: 0 keeps every preview whole", async () => {
    const store = new Store(tmp.dir, { tickMs: 60_000, statsMs: 60_000, keepDays: 0 });
    const oldKey = store.keys().find((k) => k.endsWith("000000000000"))!;
    const d = store.sessionDetail(oldKey, undefined, 10, { slim: true })!;
    expect((d.events.find((e) => e.type === "tool.ended")!.data.output as string).length).toBe(PREVIEW_CHARS);
    await store.close();
  });
});
