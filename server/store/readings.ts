// SPDX-License-Identifier: Apache-2.0
// The store's readings (ARCHITECTURE.md "The store's readings"): a pure reducer from
// protocol events to a SessionSummary, and the state machine over it. Nothing here
// touches a file or a timer; store.ts drives it.
import {
  type Attention,
  type AttentionKind,
  DONE_AFTER_MS,
  type EventSource,
  type ProtocolEvent,
  type SessionState,
  type SessionSummary,
  SNIPPET_CHARS,
  STALE_AFTER_MS,
  sessionKey,
  type Tier,
} from "../../shared/api.js";
import { detach, PREVIEW_CHARS } from "./slim.js";

const TITLE_RANK: Record<string, number> = { custom: 3, harness: 2, "first-ask": 1 };
const ATTENTION_KINDS = new Set<string>(["permission", "question", "elicitation", "idle", "error"]);

/** Events a worker derives from files or clocks rather than a harness hook. Only a
 *  hook event proves the harness moved on, so only a hook event closes an attention
 *  (CONTROL.md §7). */
const NOT_HOOK = new Set(["turn.progress", "turn.transcript", "session.heartbeat", "session.backfill"]);

/** What the store keeps per session beyond the summary it serves. */
export interface SessionRecord {
  summary: SessionSummary;
  /** Whether a `session.ended` arrived. */
  ended: boolean;
  /** Whether anything but a backfill arrived. */
  live: boolean;
  /** Distinct paths from files.changed. */
  files: Set<string>;
  /** Keys of subagent sessions whose parent_id is this one. */
  childKeys: Set<string>;
}

export function newRecord(harness: string, id: string, at: string, source: EventSource): SessionRecord {
  return {
    summary: {
      key: sessionKey(harness, id),
      harness,
      id,
      state: "idle",
      stateSince: at,
      startedAt: at,
      lastAt: at,
      maxTier: 0,
      backfilled: false,
      source,
      counts: {
        events: 0,
        turns: 0,
        tools: 0,
        toolErrors: 0,
        subagents: 0,
        compactions: 0,
        filesChanged: 0,
        attentions: 0,
      },
      openAttentions: [],
      children: 0,
      recentTools: [],
    },
    ended: false,
    live: false,
    files: new Set(),
    childKeys: new Set(),
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const cut = (v: unknown, n: number): string =>
  detach((typeof v === "string" ? v : v == null ? "" : JSON.stringify(v)).slice(0, n));

/** A sender's clock may run ahead; an outbox flush is history. Clamp to arrival. */
function clampTime(time: string, arrivedAt: string): string {
  const t = Date.parse(time);
  const a = Date.parse(arrivedAt);
  if (!Number.isFinite(t)) return arrivedAt;
  return t > a ? arrivedAt : new Date(t).toISOString();
}

/** COALESCE the session block (spec §3): a later empty field never blanks a full one;
 *  a title only moves to a better or equal source. */
export function coalesceSession(s: SessionSummary, ev: ProtocolEvent): void {
  const b = ev.session;
  const put = (k: "machine" | "cwd" | "repo" | "branch" | "model" | "url", v: unknown) => {
    const t = str(v);
    if (t) s[k] = t;
  };
  put("machine", b.machine);
  put("cwd", b.cwd);
  put("repo", b.repo);
  put("branch", b.branch);
  put("model", b.model);
  put("url", b.url);
  const acc = str(b.account_id);
  if (acc) s.accountId = acc;
  if (typeof b.parent_id === "string" && b.parent_id) s.parentId = b.parent_id;
  else if (b.parent_id === null && s.parentId === undefined) s.parentId = null;
  const title = str(b.title);
  if (title) {
    const src = b.title_source && TITLE_RANK[b.title_source] ? b.title_source : undefined;
    const rank = src ? TITLE_RANK[src]! : 0;
    const have = s.titleSource ? TITLE_RANK[s.titleSource]! : s.title ? 0 : -1;
    if (rank >= have) {
      s.title = title;
      s.titleSource = src;
    }
  }
  const v = str(ev.harness.version);
  if (v) s.harnessVersion = v;
}

/** Apply one accepted event to its session record. `now` is the arrival time. */
/** Whether a permission attention came from the harness's permission hook (the one a
 *  control daemon registers and can answer): Claude Code / Codex `PermissionRequest`,
 *  or the client's `perm-` id. A `Notification` about the same prompt is not. */
export function answerableAttention(ev: ProtocolEvent): boolean {
  const id = String((ev.data as Record<string, unknown>).attention_id ?? "");
  return ev.harness.event === "PermissionRequest" || id.startsWith("perm-");
}

export function applyEvent(rec: SessionRecord, ev: ProtocolEvent, arrivedAt: string, source: EventSource): void {
  const s = rec.summary;
  const at = clampTime(ev.time, arrivedAt);
  const d = ev.data;
  coalesceSession(s, ev);
  const first = s.counts.events === 0;
  s.counts.events++;
  s.source = source;
  if (ev.tier > s.maxTier) s.maxTier = ev.tier as Tier;

  if (ev.type === "session.backfill") {
    // A backfill's own time is when it was found; started_at / last_at are the facts.
    const started = str(d.started_at) ?? at;
    const last = str(d.last_at) ?? at;
    if (first || !rec.live) {
      s.startedAt = started < last ? started : last;
      s.lastAt = started < last ? last : started;
    } else {
      if (started < s.startedAt) s.startedAt = started;
      if (last > s.lastAt) s.lastAt = last;
    }
    const turns = num(d.turns);
    if (turns !== undefined && turns > s.counts.turns) s.counts.turns = turns;
  } else {
    if (first || !rec.live) {
      // The first live event: a backfill's span, if any, is history before it.
      s.startedAt = rec.live || first ? at : s.startedAt < at ? s.startedAt : at;
      s.lastAt = at;
    } else {
      if (at < s.startedAt) s.startedAt = at;
      if (at > s.lastAt) s.lastAt = at;
    }
    rec.live = true;
  }
  s.backfilled = !rec.live;

  // A notification *about* a permission prompt (Claude Code's Notification hook,
  // `notif-…`, no tool, no message) arriving while the prompt itself is open: the
  // same prompt, not a new one. It neither closes nor duplicates the answerable one.
  const twin =
    ev.type === "attention.needed" &&
    d.kind === "permission" &&
    !answerableAttention(ev) &&
    s.openAttentions.some((x) => x.kind === "permission" && x.answerable);
  // CONTROL.md §7: the session's next hook event closes whatever attention was open.
  if (!twin && !NOT_HOOK.has(ev.type) && ev.type !== "attention.cleared" && s.openAttentions.length) {
    if (
      ev.type !== "attention.needed" ||
      str(d.attention_id) !== s.openAttentions[s.openAttentions.length - 1]?.attentionId
    )
      s.openAttentions = [];
  }

  switch (ev.type) {
    case "session.started":
      break;
    case "session.ended":
      rec.ended = true;
      s.endedAt = at;
      s.currentTurn = undefined;
      s.currentTool = undefined;
      s.progress = undefined;
      s.openAttentions = [];
      break;
    case "turn.started": {
      s.counts.turns++;
      const promptChars = num(d.prompt_chars);
      s.currentTurn = { turnId: str(d.turn_id), since: at, ...(promptChars !== undefined ? { promptChars } : {}) };
      s.currentTool = undefined;
      break;
    }
    case "turn.ended":
      s.currentTurn = undefined;
      s.currentTool = undefined;
      s.progress = undefined;
      break;
    case "turn.progress": {
      const turn = num(d.turn);
      if (turn !== undefined) {
        s.progress = {
          turn,
          user: cut(d.user, PREVIEW_CHARS),
          assistant: detach(cut(d.assistant, 2 * PREVIEW_CHARS).slice(-PREVIEW_CHARS)),
          at: str(d.at) ?? at,
        };
      }
      s.currentTurn ??= { since: at };
      break;
    }
    case "turn.transcript": {
      const turn = num(d.turn);
      if (s.progress && (turn === undefined || turn >= s.progress.turn)) s.progress = undefined;
      s.lastUser = cut(d.user, SNIPPET_CHARS);
      s.lastAssistant = cut(d.assistant, SNIPPET_CHARS);
      break;
    }
    case "tool.started": {
      const tool = str(d.tool);
      if (tool) s.currentTool = { tool, callId: str(d.call_id), since: at, agentId: str(d.agent_id) };
      s.currentTurn ??= { turnId: str(d.turn_id), since: at };
      break;
    }
    case "tool.ended": {
      s.counts.tools++;
      const ok = d.ok !== false;
      if (!ok) s.counts.toolErrors++;
      const tool = str(d.tool) ?? "?";
      const ms = num(d.ms);
      s.recentTools.push({ tool, ok, ...(ms !== undefined ? { ms } : {}) });
      if (s.recentTools.length > 8) s.recentTools.splice(0, s.recentTools.length - 8);
      const cur = s.currentTool;
      if (cur) {
        const callId = str(d.call_id);
        if ((callId && cur.callId === callId) || (!callId && cur.tool === tool) || (!cur.callId && cur.tool === tool))
          s.currentTool = undefined;
      }
      s.currentTurn ??= { turnId: str(d.turn_id), since: at };
      break;
    }
    case "files.changed": {
      const paths = Array.isArray(d.paths) ? d.paths : [];
      for (const p of paths) if (typeof p === "string") rec.files.add(p);
      s.counts.filesChanged = rec.files.size;
      break;
    }
    case "attention.needed": {
      const attentionId = str(d.attention_id) ?? ev.id;
      const kind = (ATTENTION_KINDS.has(String(d.kind)) ? d.kind : "question") as AttentionKind;
      const a: Attention = { attentionId, kind, at };
      const tool = str(d.tool);
      const message = str(d.message);
      if (tool) a.tool = tool;
      if (message) a.message = message.slice(0, 200);
      if (kind === "permission" && answerableAttention(ev)) a.answerable = true;
      if (twin) break; // folded into the open, answerable prompt
      s.openAttentions = [...s.openAttentions.filter((x) => x.attentionId !== attentionId), a];
      s.counts.attentions++;
      break;
    }
    case "attention.cleared": {
      const attentionId = str(d.attention_id);
      s.openAttentions = attentionId ? s.openAttentions.filter((x) => x.attentionId !== attentionId) : [];
      break;
    }
    case "subagent.started":
      s.counts.subagents++;
      s.currentTurn ??= { since: at };
      break;
    case "session.heartbeat":
      s.currentTurn ??= { since: at };
      break;
    case "context.compacted":
      s.counts.compactions++;
      break;
    default:
      break;
  }
}

/** The state machine (shared/api.ts SessionState) read at `now`. Returns the state
 *  and when it began. */
export function evaluateState(rec: SessionRecord, now: number): { state: SessionState; since: string } {
  const s = rec.summary;
  const last = Date.parse(s.lastAt);
  const silent = now - last;
  if (s.openAttentions.length && silent < DONE_AFTER_MS) {
    return { state: "needs_you", since: s.openAttentions[s.openAttentions.length - 1]!.at };
  }
  if (rec.ended) return { state: "done", since: s.endedAt ?? s.lastAt };
  if (!rec.live) return { state: "done", since: s.lastAt };
  if (silent >= DONE_AFTER_MS) return { state: "done", since: new Date(last + DONE_AFTER_MS).toISOString() };
  if (s.currentTurn) {
    if (silent < STALE_AFTER_MS) return { state: "working", since: s.currentTurn.since };
    return { state: "stale", since: new Date(last + STALE_AFTER_MS).toISOString() };
  }
  return { state: "idle", since: s.lastAt };
}

/** Write the evaluated state into the summary; true when it changed. */
export function refreshState(rec: SessionRecord, now: number): boolean {
  const { state, since } = evaluateState(rec, now);
  const s = rec.summary;
  if (state === "done" && !rec.ended && s.openAttentions.length) {
    // Silent for DONE_AFTER_MS: the hook's window closed long ago.
    s.openAttentions = [];
    s.currentTurn = undefined;
    s.currentTool = undefined;
  }
  if (s.state === state && s.stateSince === since) return false;
  s.state = state;
  s.stateSince = since;
  return true;
}
