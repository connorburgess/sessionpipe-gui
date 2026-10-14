// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Outbox } from "sessionpipe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Session, tempDir } from "../../test/events.js";
import { Store } from "../store/store.js";
import { resolveOutboxRoot, startOutboxSource } from "./outbox.js";

let tmp: { dir: string; cleanup: () => void };
let store: Store;
let spState: string;

beforeEach(() => {
  tmp = tempDir();
  spState = path.join(tmp.dir, "sessionpipe");
  store = new Store(path.join(tmp.dir, "gui"));
});
afterEach(async () => {
  await store.close();
  tmp.cleanup();
});

/** Write events the way the client does: Outbox.append into <state>/outbox/<harness>/<id>.jsonl. */
const write = (s: Session, events: ReturnType<Session["ev"]>[]) =>
  new Outbox(spState).append({ harness: s.harness, session: s.id }, events as never);

describe("outbox source", () => {
  it("reads every file from the start on first run, then only what is new", () => {
    const a = new Session("aaa");
    const b = new Session("bbb", "codex");
    write(a, [a.ev("session.started"), a.ev("turn.started")]);
    write(b, [b.ev("session.started")]);
    const src = startOutboxSource(store, { path: spState, intervalMs: 50 });
    try {
      expect(src.status()).toMatchObject({ path: path.join(spState, "outbox"), sessions: 2, enabled: true, events: 3 });
      expect(store.stats()).toMatchObject({ events: 3, sessions: 2 });
      expect(store.session("codex:bbb")!.source).toBe("outbox");
      write(a, [a.ev("tool.started", { tool: "Bash" })]);
      src.tick();
      expect(store.session("claude-code:aaa")!.counts.events).toBe(3);
      expect(src.status().events).toBe(4);
      const offsets = JSON.parse(readFileSync(path.join(store.dir, "outbox-offsets.json"), "utf8"));
      expect(Object.keys(offsets).sort()).toEqual(["claude-code/aaa", "codex/bbb"]);
    } finally {
      src.stop();
    }
  });

  it("drains a long file in one tick and skips lines that are not events", () => {
    const a = new Session("long");
    const events = [a.ev("session.started")];
    for (let i = 0; i < 450; i++) events.push(a.ev("tool.ended", { tool: "Bash", ok: true }));
    write(a, events);
    write(a, [{ ...a.ev("turn.started"), id: "bad" } as never]);
    const src = startOutboxSource(store, { path: path.join(spState, "outbox") });
    src.stop();
    expect(store.session("claude-code:long")!.counts.events).toBe(451);
  });

  it("resumes from the persisted offsets after a restart without duplicates", () => {
    const a = new Session("resume");
    write(a, [a.ev("session.started"), a.ev("turn.started")]);
    const first = startOutboxSource(store, { path: spState });
    first.stop();
    expect(existsSync(path.join(store.dir, "outbox-offsets.json"))).toBe(true);
    write(a, [a.ev("turn.ended", { reason: "stop" })]);
    const second = startOutboxSource(store, { path: spState });
    second.stop();
    expect(second.status().events).toBe(1);
    expect(store.session("claude-code:resume")!.counts.events).toBe(3);
    expect(store.stats().events).toBe(3);
  });

  it("copes with no outbox at all", () => {
    const src = startOutboxSource(store, { path: path.join(tmp.dir, "nowhere") });
    src.stop();
    expect(src.status().sessions).toBe(0);
  });

  it("resolves the state dir from either spelling", () => {
    write(new Session("x"), [new Session("x").ev("session.started")]);
    expect(resolveOutboxRoot(spState)).toBe(spState);
    expect(resolveOutboxRoot(path.join(spState, "outbox"))).toBe(spState);
    expect(resolveOutboxRoot()).toMatch(/sessionpipe$/);
  });
});
