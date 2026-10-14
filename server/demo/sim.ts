// SPDX-License-Identifier: Apache-2.0
// Owned by: demo. The simulation: a small team's agents on a virtual clock. Every
// session is a generator that yields how long to wait (virtual ms) between the events
// it emits; `advance(to)` runs whatever is due and hands back the events in order. The
// runner in index.ts maps virtual time onto the wall clock; the tests drive it directly.
// Every event is a tier-3 sessionpipe event exactly as the client would send it:
// the harness's own hook names, a session block that grows as the worker learns facts,
// seq monotonic per session, ids in each harness's shape.
import { ulid } from "sessionpipe-core";
import type { ProtocolEvent, ProtocolSession } from "../../shared/api.js";
import {
  BACKFILL_TITLES,
  CLAUDE_TURNS,
  CODEX_TURNS,
  GEMINI_TURNS,
  HARNESS_VERSION,
  type HarnessName,
  MACHINE_NAMES,
  MODELS,
  REPOS,
  RESUME_TURN,
  type Repo,
  SILENT_TURN,
  type ToolStep,
  type TurnScript,
} from "./content.js";
import { Rng } from "./rng.js";

export interface SimOptions {
  machines?: number;
  seed?: number;
  /** Wall-clock ms that virtual 0 maps to. */
  startAt?: number;
  /** Virtual ms per wall ms: the event times are startAt + virtual / speed. */
  speed?: number;
}

type Script = Generator<number, void, undefined>;
interface Actor {
  at: number;
  order: number;
  gen: Script;
}

const DAY = 86_400_000;
const PROGRESS_EVERY_MS = 20_000;
const TITLE_RANK = { "first-ask": 0, harness: 1, custom: 2 } as const;
/** The curated opening scenes get this long before random sessions join in. */
const OPENING_MS = 150_000;

type HookKey =
  | "start"
  | "prompt"
  | "preTool"
  | "postTool"
  | "postToolFail"
  | "permission"
  | "stop"
  | "stopFail"
  | "subStart"
  | "subStop"
  | "compact"
  | "end";

/** How one harness names its hooks and shapes its ids (ADAPTERS.md). */
interface Profile {
  name: HarnessName;
  ev: Record<HookKey, string>;
  callId?: (rng: Rng) => string;
  turnId?: (rng: Rng, wall: number) => string;
  attentionId: (rng: Rng, wall: number) => string;
  /** Emits turn.progress (optional for senders; the Claude Code client does). */
  progress: boolean;
  /** Knows the model at session start (Codex's hook payload carries it). */
  modelAtStart: boolean;
}

const PROFILES: Record<HarnessName, Profile> = {
  "claude-code": {
    name: "claude-code",
    ev: {
      start: "SessionStart",
      prompt: "UserPromptSubmit",
      preTool: "PreToolUse",
      postTool: "PostToolUse",
      postToolFail: "PostToolUseFailure",
      permission: "PermissionRequest",
      stop: "Stop",
      stopFail: "StopFailure",
      subStart: "SubagentStart",
      subStop: "SubagentStop",
      compact: "PreCompact",
      end: "SessionEnd",
    },
    callId: (r) => r.toolu(),
    turnId: (r) => r.uuid(),
    attentionId: (r) => r.perm(),
    progress: true,
    modelAtStart: false,
  },
  codex: {
    name: "codex",
    ev: {
      start: "SessionStart",
      prompt: "UserPromptSubmit",
      preTool: "PreToolUse",
      postTool: "PostToolUse",
      postToolFail: "PostToolUse",
      permission: "PermissionRequest",
      stop: "Stop",
      stopFail: "Stop",
      subStart: "SubagentStart",
      subStop: "SubagentStop",
      compact: "PreCompact",
      end: "SessionEnd",
    },
    callId: (r) => `exec-${r.uuid()}`,
    turnId: (r, wall) => r.uuid7(wall),
    attentionId: (r) => `exec-${r.uuid()}`,
    progress: false,
    modelAtStart: true,
  },
  "gemini-cli": {
    name: "gemini-cli",
    ev: {
      start: "SessionStart",
      prompt: "BeforeAgent",
      preTool: "BeforeTool",
      postTool: "AfterTool",
      postToolFail: "AfterTool",
      permission: "Notification",
      stop: "AfterAgent",
      stopFail: "AfterAgent",
      subStart: "",
      subStop: "",
      compact: "PreCompress",
      end: "SessionEnd",
    },
    attentionId: (_r, wall) => `notif-${wall}`,
    progress: false,
    modelAtStart: false,
  },
};

type Block = Omit<ProtocolSession, "id" | "seq">;

const prune = (o: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
};

/** The first line of a prompt, cut the way the harness readers cut a first-ask title. */
export function firstAsk(prompt: string, max = 50): string {
  const line =
    prompt
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max).replace(/\s+\S*$/, "")}…` : line;
}

/** One session as the sender knows it: its seq counter and the facts learned so far. */
export class Sess {
  seq: number;
  readonly block: Block;
  constructor(
    readonly sim: Simulation,
    readonly profile: Profile,
    readonly id: string,
    block: Block,
    seq = 0,
  ) {
    this.block = { ...block };
    this.seq = seq;
  }
  /** Adds facts as the worker learns them. A title never replaces one from a better
   *  source (custom > harness > first-ask), as the harness readers rank them. */
  learn(fields: Partial<Block>): void {
    const { title, title_source, ...rest } = fields;
    Object.assign(this.block, prune(rest as Record<string, unknown>));
    if (title && title_source && TITLE_RANK[title_source] >= TITLE_RANK[this.block.title_source ?? "first-ask"]) {
      this.block.title = title;
      this.block.title_source = title_source;
    }
  }
  emit(type: string, data: Record<string, unknown>, event: string, version = true): ProtocolEvent {
    const harness: ProtocolEvent["harness"] = { name: this.profile.name };
    if (version) harness.version = HARNESS_VERSION[this.profile.name];
    if (event) harness.event = event;
    return this.sim.emit(type, harness, { id: this.id, seq: this.seq++, ...this.block }, prune(data));
  }
}

export class Simulation {
  /** Virtual ms since start. */
  now = 0;
  readonly rng: Rng;
  readonly machines: string[];
  readonly startAt: number;
  readonly speed: number;
  /** Sessions that are running right now (the director keeps the board from overflowing). */
  live = 0;
  private actors: Actor[] = [];
  private out: ProtocolEvent[] = [];
  private order = 0;
  private accounts = new Map<string, string>();
  private ended: Sess[] = [];

  constructor(opts: SimOptions = {}) {
    this.rng = new Rng(opts.seed ?? 20261014);
    const n = Math.min(MACHINE_NAMES.length, Math.max(1, Math.floor(opts.machines ?? 2)));
    this.machines = MACHINE_NAMES.slice(0, n);
    this.startAt = opts.startAt ?? Date.now();
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.spawn(this.director());
  }

  /** Wall-clock ms of a virtual instant. */
  wall(v = this.now): number {
    return Math.round(this.startAt + v / this.speed);
  }

  spawn(gen: Script, delay = 0): void {
    this.actors.push({ at: this.now + delay, order: this.order++, gen });
  }

  /** The virtual time of the next event, or null when nothing is scheduled. */
  nextDue(): number | null {
    let min: number | null = null;
    for (const a of this.actors) if (min === null || a.at < min) min = a.at;
    return min;
  }

  /** Run everything due up to `to` (virtual ms) and return the events, in emit order. */
  advance(to: number): ProtocolEvent[] {
    for (;;) {
      let next: Actor | undefined;
      for (const a of this.actors)
        if (a.at <= to && (!next || a.at < next.at || (a.at === next.at && a.order < next.order))) next = a;
      if (!next) break;
      this.now = Math.max(this.now, next.at);
      const r = next.gen.next();
      if (r.done) this.actors = this.actors.filter((a) => a !== next);
      else next.at = this.now + Math.max(0, r.value);
    }
    this.now = Math.max(this.now, to);
    const out = this.out;
    this.out = [];
    return out;
  }

  emit(
    type: string,
    harness: ProtocolEvent["harness"],
    session: ProtocolSession,
    data: Record<string, unknown>,
    at = this.wall(),
  ): ProtocolEvent {
    const e: ProtocolEvent = {
      protocol: 1,
      id: ulid(at),
      type,
      time: new Date(at).toISOString(),
      tier: 3,
      harness,
      session,
      privacy: { rulesets: ["secrets@1"], pii: false },
      data,
    };
    this.out.push(e);
    return e;
  }

  /** An opaque, stable account id per machine and harness (never an email). */
  account(machine: string, harness: HarnessName): string {
    const k = `${machine}/${harness}`;
    let id = this.accounts.get(k);
    if (!id) {
      id = this.rng.uuid();
      this.accounts.set(k, id);
    }
    return id;
  }

  newSessionId(harness: HarnessName): string {
    return harness === "codex" ? this.rng.uuid7(this.wall()) : this.rng.uuid();
  }

  // ---------- the cast ----------

  private *director(): Script {
    const rng = this.rng;
    const m = (i: number) => this.machines[i % this.machines.length] as string;
    const resumable = this.backfill();

    // The showcase: one Claude Code session that plays every scenario, and keeps coming back.
    const showcase = () =>
      this.session({
        harness: "claude-code",
        machine: m(0),
        repo: REPOS[0] as Repo,
        branch: "fix/webhook-retry",
        turns: [...CLAUDE_TURNS],
        source: "startup",
        end: "exit",
        pause: 20_000,
      });
    this.spawn(showcase());
    this.spawn(
      this.session({
        harness: "codex",
        machine: m(1),
        repo: REPOS[1] as Repo,
        branch: "chore/pnpm-cache",
        turns: CODEX_TURNS.slice(0, 2),
        source: "startup",
        end: "exit",
      }),
      15_000,
    );
    this.spawn(
      this.session({
        harness: "claude-code",
        machine: m(1),
        repo: REPOS[3] as Repo,
        branch: "feat/offline-cart",
        turns: [SILENT_TURN],
        source: "startup",
        end: "exit",
      }),
      20_000,
    );
    this.spawn(
      this.session({
        harness: "gemini-cli",
        machine: m(0),
        repo: REPOS[2] as Repo,
        branch: "main",
        turns: GEMINI_TURNS.slice(0, 2),
        source: "startup",
        end: "exit",
      }),
      40_000,
    );
    this.spawn(
      this.session({
        harness: "claude-code",
        machine: resumable.block.machine as string,
        repo: REPOS[4] as Repo,
        branch: "main",
        turns: [RESUME_TURN, CLAUDE_TURNS[7] as TurnScript],
        source: "resume",
        end: "exit",
        resume: resumable,
      }),
      90_000,
    );

    let lastShowcase = this.now;
    yield OPENING_MS;
    for (;;) {
      yield rng.int(45_000, 120_000);
      if (this.now - lastShowcase > 7 * 60_000) {
        lastShowcase = this.now;
        this.spawn(showcase());
        continue;
      }
      if (this.live >= 6) continue;
      const harness: HarnessName = rng.pick(["claude-code", "claude-code", "claude-code", "codex", "gemini-cli"]);
      const pool = harness === "claude-code" ? CLAUDE_TURNS : harness === "codex" ? CODEX_TURNS : GEMINI_TURNS;
      const repos =
        harness === "claude-code"
          ? [REPOS[0], REPOS[3], REPOS[4], REPOS[5]]
          : harness === "codex"
            ? [REPOS[1], REPOS[5]]
            : [REPOS[2]];
      const repo = rng.pick(repos) as Repo;
      const from = rng.int(0, pool.length - 1);
      const n = rng.int(1, Math.min(3, pool.length));
      const turns = Array.from({ length: n }, (_, i) => pool[(from + i) % pool.length] as TurnScript);
      const prior = this.ended.filter((s) => s.profile.name === harness);
      const resume = prior.length && rng.chance(0.2) ? (rng.pick(prior) as Sess) : undefined;
      this.spawn(
        this.session({
          harness,
          machine: resume ? (resume.block.machine as string) : rng.pick(this.machines),
          repo,
          branch: rng.pick(repo.branches),
          turns,
          source: resume ? "resume" : "startup",
          end: rng.chance(0.8) ? "exit" : rng.chance(0.5) ? "other" : "clear",
          resume,
        }),
      );
    }
  }

  /** ~15 historical sessions over the last 30 days, oldest first; returns one a later
   *  session resumes. */
  private backfill(): Sess {
    const rng = this.rng;
    const items: { sess: Sess; startedAt: number; lastAt: number; turns: number }[] = [];
    const count = BACKFILL_TITLES.length - 1;
    for (let i = 0; i < count; i++) {
      const harness: HarnessName = i % 5 === 3 ? "codex" : i % 7 === 6 ? "gemini-cli" : "claude-code";
      const title = BACKFILL_TITLES[i] as (typeof BACKFILL_TITLES)[number];
      const repo = (i === 0 ? REPOS[4] : rng.pick(REPOS)) as Repo;
      const machine = rng.pick(this.machines);
      const startedAt = this.wall() - Math.round(((i + 0.5 + rng.next() * 0.8) / count) * 30 * DAY);
      const lastAt = startedAt + rng.int(5, 180) * 60_000;
      const sess = new Sess(this, PROFILES[harness], this.newSessionId(harness), {
        machine,
        cwd: repo.cwd,
        repo: repo.repo,
        branch: rng.pick(repo.branches),
        model: rng.pick(MODELS[harness]),
        title: title.text,
        title_source: title.source,
        account_id: this.account(machine, harness),
      });
      items.push({ sess, startedAt, lastAt, turns: rng.int(1, 40) });
    }
    items.sort((a, b) => a.lastAt - b.lastAt);
    for (const it of items) {
      const data = {
        started_at: new Date(it.startedAt).toISOString(),
        last_at: new Date(it.lastAt).toISOString(),
        turns: it.turns,
      };
      this.emit(
        "session.backfill",
        { name: it.sess.profile.name, event: "backfill" },
        { id: it.sess.id, seq: it.sess.seq++, ...it.sess.block },
        data,
        it.lastAt,
      );
    }
    const resumable =
      items.find((it) => it.sess.block.title === BACKFILL_TITLES[0]?.text) ?? (items[0] as (typeof items)[number]);
    return resumable.sess;
  }

  private *session(p: {
    harness: HarnessName;
    machine: string;
    repo: Repo;
    branch: string;
    turns: readonly TurnScript[];
    source: "startup" | "resume";
    end: "exit" | "other" | "clear";
    pause?: number;
    resume?: Sess;
  }): Script {
    const rng = this.rng;
    const profile = PROFILES[p.harness];
    const sess =
      p.resume ??
      new Sess(this, profile, this.newSessionId(p.harness), {
        machine: p.machine,
        cwd: p.repo.cwd,
        account_id: this.account(p.machine, p.harness),
        ...(profile.modelAtStart ? { model: rng.pick(MODELS[p.harness]) } : {}),
      });
    this.live++;
    sess.emit("session.started", { source: p.source }, profile.ev.start);
    yield rng.ms(8000, 2000);
    let turn = p.resume ? rng.int(3, 12) : 0;
    for (const [i, script] of p.turns.entries()) {
      if (i === 0 && !p.resume) {
        // The worker reads git facts and the first ask between the start hook and the first prompt.
        sess.learn({ repo: p.repo.repo, branch: p.branch, title: firstAsk(script.prompt), title_source: "first-ask" });
      }
      yield* this.playTurn(sess, script, turn++);
      if (script.abandon) {
        this.live--;
        return;
      }
      yield p.pause ?? rng.ms(30_000, 5000);
    }
    sess.emit("session.ended", { reason: p.end }, profile.ev.end);
    this.live--;
    this.ended.push(sess);
  }

  private *playTurn(sess: Sess, script: TurnScript, turn: number): Script {
    const rng = this.rng;
    const profile = sess.profile;
    const ev = profile.ev;
    const turnId = profile.turnId?.(rng, this.wall());
    const user = script.prompt;
    const startedAt = this.now;
    let said = "";
    let lastProgress = -Infinity;
    const progress = (event: string) => {
      sess.emit("turn.progress", { turn, user, assistant: said, at: new Date(this.wall()).toISOString() }, event);
      lastProgress = this.now;
    };

    sess.emit("turn.started", { turn_id: turnId, prompt_chars: [...user].length }, ev.prompt);
    if (profile.progress) progress(ev.prompt);
    yield rng.ms(4000, 800);

    for (const [i, step] of script.steps.entries()) {
      if (step.permission) {
        const attentionId = profile.attentionId(rng, this.wall());
        sess.emit(
          "attention.needed",
          {
            attention_id: attentionId,
            kind: "permission",
            tool: step.tool,
            message: `${step.tool} ${step.permission}`.slice(0, 200),
          },
          ev.permission,
        );
        yield rng.int(32_000, 48_000);
        sess.emit("attention.cleared", { attention_id: attentionId, how: "answered" }, ev.preTool);
      }
      const callId = profile.callId?.(rng);
      sess.emit("tool.started", { tool: step.tool, call_id: callId, turn_id: turnId, input: step.input }, ev.preTool);
      yield step.ms;
      const ok = step.ok ?? true;
      let output = step.output;
      let agentId: string | undefined;
      if (step.subagent) {
        agentId = rng.agent();
        output = { ...(output as Record<string, unknown>), agentId };
      }
      sess.emit(
        "tool.ended",
        {
          tool: step.tool,
          call_id: callId,
          turn_id: turnId,
          ms: step.ms,
          ok,
          error: ok ? undefined : step.error,
          input: step.input,
          output: output === undefined ? null : output,
        },
        ok ? ev.postTool : ev.postToolFail,
      );
      if (step.paths) sess.emit("files.changed", { paths: step.paths }, ok ? ev.postTool : ev.postToolFail);
      if (i === 0 && !sess.block.model) {
        sess.learn({ model: rng.pick(MODELS[profile.name]) });
        if (profile.name === "claude-code") sess.learn({ url: `https://claude.ai/code/session_01${rng.base62(22)}` });
      }
      if (i === 1 && script.title) sess.learn({ title: script.title.text, title_source: script.title.source });
      if (step.say && step.say !== said) {
        said = step.say;
        if (profile.progress && this.now - lastProgress >= PROGRESS_EVERY_MS)
          progress(ok ? ev.postTool : ev.postToolFail);
      }
      if (step.subagent && agentId) yield* this.subagent(sess, step.subagent, agentId);
      if (step.compactAfter) {
        yield rng.ms(2000, 500);
        sess.emit("context.compacted", { trigger: "auto" }, ev.compact);
        yield rng.ms(6000, 2000);
        sess.emit("session.started", { source: "compact" }, ev.start);
      }
      yield rng.ms(5000, 1200);
    }

    if (script.abandon) return;
    const ms = this.now - startedAt;
    const endEvent = script.error ? ev.stopFail : ev.stop;
    sess.emit(
      "turn.ended",
      script.error
        ? { turn_id: turnId, reason: "error", error: script.error, ms }
        : { turn_id: turnId, reason: "stop", ms },
      endEvent,
    );
    sess.emit(
      "turn.transcript",
      { turn, user, assistant: script.final, at: new Date(this.wall()).toISOString() },
      endEvent,
    );
  }

  /** A subagent: the parent announces it, the child runs as its own session with
   *  parent_id and agent_id on every tool, then the parent closes it. */
  private *subagent(parent: Sess, sub: { type: string; steps: ToolStep[] }, agentId: string): Script {
    const rng = this.rng;
    const ev = parent.profile.ev;
    parent.emit("subagent.started", { agent_id: agentId, agent_type: sub.type }, ev.subStart);
    const { title: _t, title_source: _ts, url: _u, ...inherited } = parent.block;
    const child = new Sess(this, parent.profile, agentId, { ...inherited, parent_id: parent.id });
    child.emit("session.started", { source: "fork" }, ev.subStart);
    yield rng.ms(1500, 300);
    for (const step of sub.steps) {
      const callId = parent.profile.callId?.(rng);
      child.emit(
        "tool.started",
        { tool: step.tool, call_id: callId, agent_id: agentId, input: step.input },
        ev.preTool,
      );
      yield step.ms;
      child.emit(
        "tool.ended",
        {
          tool: step.tool,
          call_id: callId,
          agent_id: agentId,
          ms: step.ms,
          ok: step.ok ?? true,
          input: step.input,
          output: step.output ?? null,
        },
        ev.postTool,
      );
      yield rng.ms(3000, 800);
    }
    child.emit("session.ended", { reason: "other" }, ev.subStop);
    parent.emit("subagent.ended", { agent_id: agentId, agent_type: sub.type }, ev.subStop);
  }
}
