// SPDX-License-Identifier: Apache-2.0
// The simulation is checked on its own virtual clock (deterministic, instant), then the
// runner on the wall clock at speed 1000 against a fake store.
import { describe, expect, it } from "vitest";
import type { EventSource, ProtocolEvent } from "../../shared/api.js";
import type { Store } from "../store/store.js";
import { startDemo } from "./index.js";
import { Simulation } from "./sim.js";
import { TYPE_TIER, validate } from "./validate.js";

class FakeStore {
  batches: { events: ProtocolEvent[]; source: EventSource }[] = [];
  ingest(events: ProtocolEvent[], source: EventSource) {
    this.batches.push({ events: events.map((e) => structuredClone(e)), source });
    return { accepted: events.length, duplicates: 0, rejected: [], stored: [] };
  }
  get events(): ProtocolEvent[] {
    return this.batches.flatMap((b) => b.events);
  }
}
const asStore = (s: FakeStore) => s as unknown as Store;

const T0 = Date.parse("2026-10-14T12:00:00.000Z");
const TEN_MINUTES = 10 * 60_000;
/** Things still in flight at the cut-off are not failures: the window a tool, a
 *  permission prompt or a subagent can legitimately still be open. */
const SETTLE_MS = 90_000;

const key = (e: ProtocolEvent) => `${e.harness.name}:${e.session.id}`;

function run(seed = 7, minutes = 10, machines = 2): ProtocolEvent[] {
  const sim = new Simulation({ seed, startAt: T0, speed: 1, machines });
  return sim.advance(minutes * 60_000);
}

describe("Simulation: a 10-minute run", () => {
  const events = run();
  const cutoff = T0 + TEN_MINUTES - SETTLE_MS;
  const settled = (e: ProtocolEvent) => Date.parse(e.time) < cutoff;

  it("emits a few hundred events and every one validates", () => {
    expect(events.length).toBeGreaterThan(250);
    const bad = events.map((e) => ({ e, problems: validate(e) })).filter((x) => x.problems.length);
    expect(bad.map((x) => `${x.e.type}: ${x.problems.join("; ")}`)).toEqual([]);
    for (const e of events) {
      expect(e.tier).toBe(3);
      expect(e.tier).toBeGreaterThanOrEqual(TYPE_TIER[e.type] ?? 0);
      expect(e.privacy).toEqual({ rulesets: ["secrets@1"], pii: false });
    }
  });

  it("stamps time in emit order and ids that sort with it", () => {
    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1] as ProtocolEvent;
      const b = events[i] as ProtocolEvent;
      if (a.type === "session.backfill" || b.type === "session.backfill") continue;
      expect(Date.parse(b.time)).toBeGreaterThanOrEqual(Date.parse(a.time));
      expect(b.id > a.id).toBe(true);
    }
  });

  it("keeps seq strictly monotonic per (harness, session)", () => {
    const last = new Map<string, number>();
    for (const e of events) {
      const k = key(e);
      const prev = last.get(k);
      if (prev !== undefined) expect(e.session.seq, `${k} after seq ${prev}`).toBeGreaterThan(prev);
      last.set(k, e.session.seq);
    }
  });

  it("starts every session with session.started (or a backfill) before anything else", () => {
    const seen = new Set<string>();
    for (const e of events) {
      const k = key(e);
      if (!seen.has(k)) {
        expect(["session.started", "session.backfill"], `${k} opened with ${e.type}`).toContain(e.type);
        seen.add(k);
      }
    }
    const starts = events.filter((e) => e.type === "session.started").map((e) => e.data.source);
    expect(new Set(starts)).toEqual(new Set(["startup", "resume", "compact", "fork"]));
  });

  it("grows the session block COALESCE-style and never drops a learned field", () => {
    const known = new Map<string, Record<string, unknown>>();
    for (const e of events) {
      if (e.type === "session.backfill") continue;
      const k = key(e);
      const prev = known.get(k) ?? {};
      for (const [f, v] of Object.entries(prev))
        if (v) expect(e.session[f as keyof typeof e.session], `${k} lost ${f}`).toBeTruthy();
      known.set(k, { ...prev, ...e.session });
    }
    // The showcase session learns repo, branch, title, model and url after it started.
    const first = events.find(
      (e) => e.type === "session.started" && e.harness.name === "claude-code" && e.session.cwd === "~/code/billing",
    ) as ProtocolEvent;
    const showcase = events.filter((e) => e.session.id === first.session.id);
    expect(first.session.repo).toBeUndefined();
    expect(first.session.cwd).toBe("~/code/billing");
    const later = showcase.find((e) => e.type === "turn.ended") as ProtocolEvent;
    expect(later.session).toMatchObject({
      repo: "github.com/acme/billing",
      branch: "fix/webhook-retry",
      model: expect.stringMatching(/^claude-/),
      url: expect.stringMatching(/^https:\/\/claude\.ai\/code\/session_01/),
      account_id: expect.any(String),
    });
    const sources = new Set(showcase.map((e) => e.session.title_source).filter(Boolean));
    expect(sources).toEqual(new Set(["first-ask", "harness", "custom"]));
  });

  it("clears every attention it raises", () => {
    const open = new Map<string, ProtocolEvent>();
    for (const e of events) {
      const id = e.data.attention_id as string;
      if (e.type === "attention.needed") open.set(`${key(e)}|${id}`, e);
      if (e.type === "attention.cleared") {
        expect(open.delete(`${key(e)}|${id}`), `cleared ${id} that was never raised`).toBe(true);
        expect(e.data.how).toBe("answered");
      }
    }
    expect([...open.values()].filter(settled)).toEqual([]);
    const perm = events.find((e) => e.type === "attention.needed" && e.harness.name === "claude-code") as ProtocolEvent;
    expect(perm.harness.event).toBe("PermissionRequest");
    expect(perm.data).toMatchObject({
      kind: "permission",
      tool: "Bash",
      message: "Bash rm -rf node_modules && npm ci",
    });
    const cleared = events.find(
      (e) => e.type === "attention.cleared" && e.data.attention_id === perm.data.attention_id,
    ) as ProtocolEvent;
    expect(Date.parse(cleared.time) - Date.parse(perm.time)).toBeGreaterThanOrEqual(30_000);
    expect(
      events.some(
        (e) => e.type === "attention.needed" && e.harness.name === "gemini-cli" && e.harness.event === "Notification",
      ),
    ).toBe(true);
  });

  it("ends every tool it starts, with the same call_id", () => {
    const open = new Map<string, ProtocolEvent>();
    const idOf = (e: ProtocolEvent) => `${key(e)}|${(e.data.call_id as string | undefined) ?? e.data.tool}`;
    for (const e of events) {
      if (e.type === "tool.started") {
        expect(open.has(idOf(e)), `two tool.started for ${idOf(e)}`).toBe(false);
        open.set(idOf(e), e);
      }
      if (e.type === "tool.ended") {
        const started = open.get(idOf(e));
        expect(started, `tool.ended without its tool.started: ${idOf(e)}`).toBeDefined();
        expect(e.data.turn_id).toBe(started?.data.turn_id);
        open.delete(idOf(e));
      }
    }
    expect([...open.values()].filter(settled).map((e) => `${e.harness.name} ${e.data.tool}`)).toEqual([]);
  });

  it("runs subagents as child sessions with parent_id and agent_id", () => {
    const started = events.filter((e) => e.type === "subagent.started");
    expect(started.length).toBeGreaterThan(0);
    for (const s of started) {
      const agentId = s.data.agent_id as string;
      const child = events.filter((e) => e.session.id === agentId);
      expect(child.length).toBeGreaterThan(2);
      for (const e of child) {
        expect(e.session.parent_id).toBe(s.session.id);
        if (e.type.startsWith("tool.")) expect(e.data.agent_id).toBe(agentId);
      }
      const ended = events.find((e) => e.type === "subagent.ended" && e.data.agent_id === agentId) as ProtocolEvent;
      expect(ended.session.id).toBe(s.session.id);
      const agentTool = events.find(
        (e) =>
          e.type === "tool.ended" &&
          e.data.tool === "Agent" &&
          (e.data.output as { agentId?: string }).agentId === agentId,
      );
      expect(agentTool).toBeDefined();
    }
  });

  it("covers every scenario in the first minutes", () => {
    const types = new Set(events.map((e) => e.type));
    for (const t of [
      "session.backfill",
      "session.started",
      "session.ended",
      "turn.started",
      "turn.progress",
      "turn.transcript",
      "turn.ended",
      "tool.started",
      "tool.ended",
      "files.changed",
      "attention.needed",
      "attention.cleared",
      "subagent.started",
      "subagent.ended",
      "context.compacted",
    ])
      expect(types, t).toContain(t);

    const hookNames = (h: string) => new Set(events.filter((e) => e.harness.name === h).map((e) => e.harness.event));
    for (const n of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PermissionRequest",
      "SubagentStart",
      "SubagentStop",
      "PreCompact",
      "Stop",
      "StopFailure",
      "SessionEnd",
    ])
      expect(hookNames("claude-code"), n).toContain(n);
    for (const n of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"])
      expect(hookNames("codex"), n).toContain(n);
    for (const n of [
      "SessionStart",
      "BeforeAgent",
      "BeforeTool",
      "AfterTool",
      "Notification",
      "AfterAgent",
      "SessionEnd",
    ])
      expect(hookNames("gemini-cli"), n).toContain(n);

    const tools = new Set(events.filter((e) => e.type === "tool.ended").map((e) => e.data.tool));
    for (const t of [
      "Read",
      "Grep",
      "Edit",
      "Write",
      "Bash",
      "WebSearch",
      "Agent",
      "mcp__github__search_issues",
      "read_file",
      "run_shell_command",
    ])
      expect(tools, t).toContain(t);
    expect(events.some((e) => e.type === "tool.ended" && e.data.ok === false && typeof e.data.error === "string")).toBe(
      true,
    );
    expect(events.some((e) => e.type === "tool.ended" && JSON.stringify(e.data.output).includes("[redacted]"))).toBe(
      true,
    );
    expect(
      events.some((e) => e.type === "turn.ended" && e.data.reason === "error" && e.data.error === "api_overloaded"),
    ).toBe(true);
    expect(
      events
        .filter((e) => e.type === "turn.ended" && e.data.reason === "stop")
        .every((e) => Number.isInteger(e.data.ms)),
    ).toBe(true);
    expect(events.some((e) => e.type === "context.compacted" && e.data.trigger === "auto")).toBe(true);
    expect(events.some((e) => e.type === "session.ended" && e.data.reason === "exit")).toBe(true);

    expect(new Set(events.map((e) => e.session.machine))).toEqual(new Set(["studio-mac", "build-box"]));
    const models = new Set(events.map((e) => e.session.model).filter(Boolean));
    for (const m of ["claude-fable-5-1", "claude-opus-5-5", "gpt-5.4-codex", "gemini-3-pro"])
      expect(models, m).toContain(m);
    expect(events.every((e) => !e.session.cwd || e.session.cwd.startsWith("~"))).toBe(true);
  });

  it("backfills ~15 sessions over the last 30 days, once, dated with turns", () => {
    const backfill = events.filter((e) => e.type === "session.backfill");
    expect(backfill.length).toBe(15);
    expect(new Set(backfill.map((e) => e.session.id)).size).toBe(15);
    for (const e of backfill) {
      expect(e.session.seq).toBe(0);
      expect(e.harness.event).toBe("backfill");
      expect(e.harness.version).toBeUndefined();
      expect(e.session.title).toBeTruthy();
      expect(Number.isInteger(e.data.turns)).toBe(true);
      const started = Date.parse(e.data.started_at as string);
      const last = Date.parse(e.data.last_at as string);
      expect(started).toBeGreaterThan(T0 - 31 * 86_400_000);
      expect(last).toBeGreaterThan(started);
      expect(Date.parse(e.time)).toBe(last);
    }
    expect(new Set(backfill.map((e) => e.harness.name))).toEqual(new Set(["claude-code", "codex", "gemini-cli"]));
    // One of them comes back to life as a resumed session with its seq continuing from 1.
    const resumed = events.find((e) => e.type === "session.started" && e.data.source === "resume") as ProtocolEvent;
    expect(backfill.some((b) => b.session.id === resumed.session.id)).toBe(true);
    expect(resumed.session.seq).toBe(1);
  });

  it("sends turn.progress with the prompt first, then growing assistant text, then the transcript", () => {
    const bySession = new Map<string, ProtocolEvent[]>();
    for (const e of events)
      if (e.type === "turn.progress" || e.type === "turn.transcript")
        bySession.set(key(e), [...(bySession.get(key(e)) ?? []), e]);
    let grew = 0;
    for (const list of bySession.values()) {
      let last: ProtocolEvent | undefined;
      for (const e of list) {
        if (e.type === "turn.progress") {
          if (last?.type === "turn.progress" && last.data.turn === e.data.turn) {
            expect((e.data.assistant as string).length).toBeGreaterThan((last.data.assistant as string).length);
            expect(Date.parse(e.time) - Date.parse(last.time)).toBeGreaterThanOrEqual(20_000);
            grew++;
          } else expect(e.data.assistant).toBe("");
        } else if (last?.type === "turn.progress") expect(e.data.turn).toBe(last.data.turn);
        last = e;
      }
    }
    expect(grew).toBeGreaterThan(0);
  });

  it("leaves one session silent mid-turn", () => {
    const first = events.find(
      (e) => e.type === "session.started" && e.harness.name === "claude-code" && e.session.cwd === "~/code/mobile",
    ) as ProtocolEvent;
    const offline = events.filter((e) => e.session.id === first.session.id);
    expect(offline.some((e) => e.type === "turn.started")).toBe(true);
    expect(offline.some((e) => e.type === "turn.ended" || e.type === "session.ended")).toBe(false);
    expect(Date.parse(offline[offline.length - 1]!.time)).toBeLessThan(T0 + 3 * 60_000);
  });

  it("is the same demo for the same seed, and another for another", () => {
    const strip = (list: ProtocolEvent[]) => list.map(({ id: _id, ...rest }) => rest);
    expect(strip(run(7))).toEqual(strip(events));
    expect(strip(run(8))).not.toEqual(strip(events));
  });

  it("puts everything on one machine when asked for one", () => {
    expect(new Set(run(7, 3, 1).map((e) => e.session.machine))).toEqual(new Set(["studio-mac"]));
  });

  it("keeps cycling for an hour without running dry or piling up", () => {
    const sim = new Simulation({ seed: 3, startAt: T0, speed: 1 });
    let n = 0;
    for (let m = 1; m <= 60; m++) {
      const slice = sim.advance(m * 60_000);
      expect(slice.flatMap((e) => validate(e))).toEqual([]);
      n += slice.length;
      expect(sim.live).toBeLessThanOrEqual(7);
    }
    expect(n).toBeGreaterThan(1500);
  });
});

describe("startDemo on the wall clock", () => {
  it("ingests valid events as demo in batches of at most 50, and stops", async () => {
    const store = new FakeStore();
    const runner = startDemo(asStore(store), { speed: 1000, seed: 11 });
    await new Promise((r) => setTimeout(r, 700));
    runner.stop();
    const after = store.batches.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(store.batches.length).toBe(after);

    expect(store.batches.length).toBeGreaterThan(1);
    for (const b of store.batches) {
      expect(b.source).toBe("demo");
      expect(b.events.length).toBeGreaterThan(0);
      expect(b.events.length).toBeLessThanOrEqual(50);
    }
    const events = store.events;
    expect(events.length).toBeGreaterThan(200);
    expect(events.flatMap((e) => validate(e))).toEqual([]);
    const types = new Set(events.map((e) => e.type));
    for (const t of [
      "session.backfill",
      "session.started",
      "tool.ended",
      "turn.transcript",
      "attention.cleared",
      "subagent.ended",
    ])
      expect(types, t).toContain(t);
    // Event times are the wall clock, not the virtual one.
    const live = events.filter((e) => e.type !== "session.backfill");
    const span = Date.parse(live[live.length - 1]!.time) - Date.parse(live[0]!.time);
    expect(span).toBeLessThan(2000);
  });
});
