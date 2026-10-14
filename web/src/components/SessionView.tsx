// SPDX-License-Identifier: Apache-2.0
// One session's body, used by the Session page and by the side panel: the sticky facts
// header, the timeline grouped by turn (newest page first, older pages on demand, the
// stream appending), the tier lens, Follow, Forget and the control strip. The page
// scrolls the window; the panel scrolls its own element (`scrollRef`).
import type { SessionSummary, StoredEvent, Tier } from "@shared/api";
import { sessionKey } from "@shared/api";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SessionControl } from "../control/SessionControl";
import { useAppState, useStore } from "../data/hooks";
import { ATTENTION_LABEL, eventSummary, modelShort, repoBranch, sessionTitle } from "../lib/format";
import { back, Link, navigate, sessionPath } from "../lib/router";
import { atTier, TIER_HINT, TIER_LABEL } from "../lib/tier";
import { clock, dur, ms, useNow } from "../lib/time";
import { Chip, HarnessGlyph, Redacted, Segmented, Since, Spinner, StateBadge, TierBadge } from "./bits";
import { plural } from "./SessionCard";

/** The newest page a session opens on, and the size of each older page. Both slim: the
 *  full event is fetched only when a row is expanded (`fill`). */
const TAIL = 100;
const OLDER = 200;
/** Characters of each tool input/output or transcript kept in a list page. */
const LIST_PREVIEW = 400;

interface Turn {
  n: number;
  start?: StoredEvent;
  items: Item[];
}
type Item =
  | { kind: "tool"; key: string; started?: StoredEvent; ended?: StoredEvent }
  | { kind: "event"; key: string; e: StoredEvent };

function groupTurns(events: StoredEvent[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn = { n: 0, items: [] };
  turns.push(cur);
  let openTools = new Map<string, Extract<Item, { kind: "tool" }>>();
  for (const e of events) {
    if (e.type === "turn.started") {
      cur = { n: turns.length, start: e, items: [] };
      turns.push(cur);
      openTools = new Map();
      continue;
    }
    if (e.type === "tool.started") {
      const id = String(e.data.call_id ?? `${e.data.tool}#${e.session.seq}`);
      const item: Extract<Item, { kind: "tool" }> = { kind: "tool", key: `t:${e.session.seq}`, started: e };
      cur.items.push(item);
      openTools.set(id, item);
      if (!e.data.call_id) openTools.set(`name:${e.data.tool}`, item);
      continue;
    }
    if (e.type === "tool.ended") {
      const id = typeof e.data.call_id === "string" ? e.data.call_id : undefined;
      const open = (id ? openTools.get(id) : undefined) ?? openTools.get(`name:${e.data.tool}`);
      if (open && !open.ended) {
        open.ended = e;
        if (id) openTools.delete(id);
        openTools.delete(`name:${e.data.tool}`);
      } else {
        cur.items.push({ kind: "tool", key: `e:${e.id}`, ended: e });
      }
      continue;
    }
    if (e.type === "turn.transcript" && turns.length > 1) {
      // Attach to the turn it describes when that turn already ended.
      const target = turns[Number(e.data.turn)];
      const home = target && target.items.some((i) => i.kind === "event" && i.e.type === "turn.ended") ? target : cur;
      home.items.push({ kind: "event", key: e.id, e });
      continue;
    }
    cur.items.push({ kind: "event", key: e.id, e });
  }
  return turns.filter((t) => t.start || t.items.length > 0);
}

export interface SessionViewProps {
  harness: string;
  id: string;
  /** "page": the window scrolls and the title row (back, title, state) is part of the view.
   *  "panel": the panel scrolls (`scrollRef`) and carries the title itself. */
  mode: "page" | "panel";
  scrollRef?: RefObject<HTMLElement | null>;
  /** The summary as soon as it is known (the panel header shows it). */
  onSession?: (s: SessionSummary) => void;
  /** After Forget succeeded; the page goes to the board by default. */
  onForgotten?: () => void;
}

export function SessionView({ harness, id, mode, scrollRef, onSession, onForgotten }: SessionViewProps) {
  const store = useStore();
  const key = sessionKey(harness, id);
  const live = useAppState().sessions.get(key);
  const machines = useAppState().machines;
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [summary, setSummary] = useState<SessionSummary | undefined>();
  const [children, setChildren] = useState<SessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lens, setLens] = useState<Tier>(3);
  const [follow, setFollow] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const lastSeq = useRef(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const [hasOlder, setHasOlder] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [tailSeq, setTailSeq] = useState(-1);
  const firstSeq = useRef<number | undefined>(undefined);
  /** Taken just before older events are prepended, to keep the viewport still: the first row
   *  on screen (by seq) and where it was, plus the page height as a fallback. */
  const anchor = useRef<{ seq: number | null; top: number; height: number; y: number } | null>(null);
  const firstPaint = useRef(true);

  // The scroller: the panel's element, or the window.
  const sc = useCallback(() => scrollRef?.current ?? null, [scrollRef]);
  const scrollHeight = useCallback(() => sc()?.scrollHeight ?? document.documentElement.scrollHeight, [sc]);
  const scrollY = useCallback(() => sc()?.scrollTop ?? window.scrollY, [sc]);
  const viewHeight = useCallback(() => sc()?.clientHeight ?? window.innerHeight, [sc]);
  const scrollTo = useCallback(
    (y: number) => {
      const el = sc();
      if (el) el.scrollTop = y;
      else window.scrollTo(0, y);
    },
    [sc],
  );
  const scrollBy = useCallback(
    (d: number) => {
      const el = sc();
      if (el) el.scrollTop += d;
      else window.scrollBy(0, d);
    },
    [sc],
  );

  // The newest page in one round trip, then let the stream append. Older pages load on demand.
  useEffect(() => {
    let cancelled = false;
    lastSeq.current = -1;
    firstSeq.current = undefined;
    firstPaint.current = true;
    setEvents([]);
    setLoading(true);
    setError(null);
    setHasOlder(false);
    const buffered: StoredEvent[] = [];
    const unsub = store.onEvent((e) => {
      if (`${e.harness.name}:${e.session.id}` === key) buffered.push(e);
    });
    (async () => {
      try {
        const d = await store.transport.session(harness, id, {
          tail: true,
          limit: TAIL,
          slim: true,
          preview: LIST_PREVIEW,
        });
        if (cancelled) return;
        const acc = d.events.slice();
        const seen = new Set(acc.map((e) => e.session.seq));
        for (const e of buffered) if (!seen.has(e.session.seq)) acc.push(e);
        acc.sort((a, b) => a.session.seq - b.session.seq);
        lastSeq.current = acc[acc.length - 1]?.session.seq ?? -1;
        firstSeq.current = d.firstSeq ?? acc[0]?.session.seq;
        setSummary(d.session);
        setChildren(d.children);
        setTotal(d.total);
        setHasOlder(!!d.hasOlder);
        setTailSeq(lastSeq.current);
        setEvents(acc);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        unsub();
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [store, harness, id, key]);

  /** The previous page of older events, prepended; the viewport stays where it was. */
  const loadOlder = useCallback(async () => {
    const before = firstSeq.current;
    if (olderBusy || before === undefined) return;
    setOlderBusy(true);
    try {
      const d = await store.transport.session(harness, id, { before, limit: OLDER, slim: true, preview: LIST_PREVIEW });
      anchor.current = { ...firstVisibleRow(rootRef.current), height: scrollHeight(), y: scrollY() };
      if (d.firstSeq !== undefined) firstSeq.current = d.firstSeq;
      setHasOlder(!!d.hasOlder);
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.session.seq));
        return [...d.events.filter((e) => !seen.has(e.session.seq)), ...prev];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOlderBusy(false);
    }
  }, [store, harness, id, olderBusy, scrollHeight, scrollY]);

  // Bottom-anchored first paint (the newest turn is what a session opens on), and a
  // still viewport when older events land above it, whether or not the browser's own
  // scroll anchoring already moved it.
  useLayoutEffect(() => {
    if (events.length === 0) return;
    if (firstPaint.current) {
      firstPaint.current = false;
      scrollTo(scrollHeight());
      return;
    }
    const a = anchor.current;
    if (a) {
      anchor.current = null;
      const row = a.seq === null ? null : rootRef.current?.querySelector(`[data-seq="${a.seq}"]`);
      if (row) {
        const d = row.getBoundingClientRect().top - a.top;
        if (Math.abs(d) > 1) scrollBy(d);
      } else {
        const want = a.y + (scrollHeight() - a.height);
        if (Math.abs(scrollY() - want) > 1) scrollTo(want);
      }
    }
  }, [events, scrollTo, scrollBy, scrollHeight, scrollY]);

  useEffect(() => {
    if (loading) return;
    return store.onEvent((e, s) => {
      if (s.key !== key) return;
      setEvents((prev) => {
        if (prev.some((p) => p.session.seq === e.session.seq)) return prev;
        const next = [...prev, e];
        if (e.session.seq < lastSeq.current) next.sort((a, b) => a.session.seq - b.session.seq);
        lastSeq.current = Math.max(lastSeq.current, e.session.seq);
        return next;
      });
      setTailSeq(e.session.seq);
      setTotal((t) => t + 1);
    });
  }, [store, key, loading]);

  const s = live ?? summary;
  useEffect(() => {
    if (s) setLens((l) => (l === 3 && s.maxTier < 3 ? s.maxTier : l));
    // only when the session first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.key]);
  useEffect(() => {
    if (s) onSession?.(s);
  }, [s, onSession]);

  const visible = useMemo(
    () => events.map((e) => atTier(e, lens)).filter((e): e is StoredEvent => e !== null),
    [events, lens],
  );
  const turns = useMemo(() => groupTurns(visible), [visible]);
  const hidden = events.length - visible.length;
  /** The loaded window ends at the latest turn, so its last turn is turn `counts.turns`. */
  const loadedTurns = turns.filter((t) => t.start).length;
  const turnOffset = Math.max(0, (s?.counts.turns ?? loadedTurns) - loadedTurns);

  // Auto-follow: stick to the bottom while live and the person has not scrolled up.
  const isLive = !!s && (s.state === "working" || s.state === "needs_you");
  // To the very end (not "endRef into view": the sticky control strip and the tab bar
  // would cover the last rows), on every new event while following.
  useEffect(() => {
    if (!follow || !isLive) return;
    scrollTo(scrollHeight());
  }, [follow, isLive, tailSeq, scrollTo, scrollHeight]);
  useEffect(() => {
    if (!follow) return;
    const target: EventTarget = sc() ?? window;
    let lastY = scrollY();
    const onScroll = () => {
      const y = scrollY();
      const atBottom = viewHeight() + y >= scrollHeight() - 120;
      if (y < lastY - 24 && !atBottom) setFollow(false);
      lastY = y;
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [follow, sc, scrollY, viewHeight, scrollHeight]);

  /** Stream and feed events are slim (data cut to a preview); the detail route has the
   *  whole event. Swap one in by its seq. */
  const fill = useCallback(
    async (e: StoredEvent) => {
      const d = await store.transport.session(harness, id, { after: e.session.seq - 1, limit: 1 });
      const full = d.events.find((x) => x.session.seq === e.session.seq);
      if (full) setEvents((prev) => prev.map((p) => (p.session.seq === full.session.seq ? full : p)));
    },
    [store, harness, id],
  );

  const forget = useCallback(async () => {
    setForgetting(true);
    try {
      await store.transport.forget(harness, id);
      store.apply({ kind: "forgotten", key });
      if (onForgotten) onForgotten();
      else navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setForgetting(false);
      setConfirm(false);
    }
  }, [store, harness, id, key, onForgotten]);

  if (!s && loading) {
    return (
      <div className="page">
        <p className="page-note">Loading session…</p>
      </div>
    );
  }
  if (!s) {
    return (
      <div className="page">
        <p className="page-note">{error ?? "No such session on this receiver."}</p>
        <Link to="/" className="btn btn--ghost">
          Back to the board
        </Link>
      </div>
    );
  }

  const parent = s.parentId ? `${s.harness}:${s.parentId}` : null;
  const control = s.machine ? machines.get(s.machine)?.control : undefined;
  const kids = children.length ? children : childrenFromStore(store, key);

  return (
    <div className={`page session ${mode === "panel" ? "session--panel" : ""}`} ref={rootRef}>
      <header className="sess-head">
        {mode === "page" && (
          <div className="sess-head-row">
            <button type="button" className="back" onClick={() => back("/")} aria-label="Back">
              ←
            </button>
            <HarnessGlyph name={s.harness} />
            <h1 className="sess-title">{sessionTitle(s)}</h1>
            <StateBadge state={s.state} since={s.stateSince} />
          </div>
        )}
        <div className="sess-facts">
          {s.machine && <Chip kind="machine">{s.machine}</Chip>}
          {repoBranch(s) && <span className="mono sess-repo">{repoBranch(s)}</span>}
          {s.cwd && !s.repo && <span className="mono sess-repo">{s.cwd}</span>}
          {s.model && <Chip kind="model">{modelShort(s.model)}</Chip>}
          <TierBadge tier={s.maxTier} />
          {parent && (
            <Link to={sessionPath(s.harness, s.parentId!)} className="chip chip--plain">
              ↰ parent session
            </Link>
          )}
          {s.url && (
            <a href={s.url} target="_blank" rel="noreferrer noopener" className="chip chip--link">
              open in {s.harness === "claude-code" ? "claude.ai" : "harness"} ↗
            </a>
          )}
        </div>
        <div className="sess-counts num">
          <span>
            started <Since iso={s.startedAt} coarse /> ago
          </span>
          <span>{plural(s.counts.turns, "turn")}</span>
          <span>{plural(s.counts.tools, "tool")}</span>
          {s.counts.toolErrors > 0 && <span className="is-err">{plural(s.counts.toolErrors, "error")}</span>}
          {s.counts.filesChanged > 0 && <span>{plural(s.counts.filesChanged, "file")}</span>}
          {s.counts.subagents > 0 && <span>{plural(s.counts.subagents, "subagent")}</span>}
          {s.counts.compactions > 0 && <span>{plural(s.counts.compactions, "compaction")}</span>}
          <span className="sess-counts-ev">{total} events</span>
        </div>
      </header>

      <div className="sess-tools">
        <div className="lens">
          <span className="lens-label">Tier lens</span>
          <Segmented<Tier>
            value={lens}
            onChange={setLens}
            label="Tier lens"
            options={([0, 1, 2, 3] as Tier[]).map((t) => ({
              value: t,
              label: String(t),
              title: `${TIER_LABEL[t]}: ${TIER_HINT[t]}`,
            }))}
          />
          <span className="lens-hint">
            {TIER_LABEL[lens]}
            {hidden > 0 ? ` · ${hidden} hidden` : ""}
            {lens > s.maxTier ? ` · arrived at tier ${s.maxTier}` : ""}
          </span>
        </div>
        <div className="sess-actions">
          {isLive && (
            <button
              type="button"
              className={`btn btn--sm ${follow ? "btn--on" : "btn--ghost"}`}
              aria-pressed={follow}
              onClick={() => setFollow((f) => !f)}
            >
              {follow ? "Following" : "Follow"}
            </button>
          )}
          {confirm ? (
            <span className="confirm" role="alertdialog" aria-label="Forget this session?">
              <span>Delete everything held for this session here?</span>
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => void forget()}
                disabled={forgetting}
              >
                {forgetting ? "Forgetting…" : "Forget"}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(false)} data-dismiss>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(true)}>
              Forget
            </button>
          )}
        </div>
      </div>

      {error && <p className="page-note is-err">{error}</p>}

      <ol className="timeline">
        {hasOlder && (
          <li className="older">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void loadOlder()}
              disabled={olderBusy}
            >
              {olderBusy ? "Loading…" : `Older turns · ${Math.max(0, total - events.length)} earlier events`}
            </button>
          </li>
        )}
        {turns.map((t) => (
          <TurnBlock
            key={t.n}
            turn={t}
            label={
              t.n === 0
                ? hasOlder
                  ? turnOffset > 0
                    ? `turn ${turnOffset} · continued`
                    : "earlier"
                  : "session"
                : `turn ${t.n + turnOffset}`
            }
            lens={lens}
            kids={kids}
            liveTurn={s.currentTurn ? t === turns[turns.length - 1] : false}
            fill={fill}
          />
        ))}
        {!loading && visible.length === 0 && <li className="page-note">No events at this tier.</li>}
      </ol>
      <div ref={endRef} />

      <div className="sess-ctl">
        <SessionControl session={s} control={control} attentions={s.openAttentions} />
      </div>
    </div>
  );
}

/** Children straight from the live store, for when the detail call has not answered yet. */
function childrenFromStore(store: ReturnType<typeof useStore>, key: string): SessionSummary[] {
  const out: SessionSummary[] = [];
  const { harness, id } = { harness: key.slice(0, key.indexOf(":")), id: key.slice(key.indexOf(":") + 1) };
  for (const s of store.get().sessions.values()) if (s.harness === harness && s.parentId === id) out.push(s);
  return out;
}

type Fill = (e: StoredEvent) => Promise<void>;

/** The first timeline row of this view whose top edge is on screen (below its sticky header), by seq. */
function firstVisibleRow(root: HTMLElement | null): { seq: number | null; top: number } {
  if (!root) return { seq: null, top: 0 };
  const headerBottom = root.querySelector(".sess-head")?.getBoundingClientRect().bottom ?? 0;
  for (const el of root.querySelectorAll<HTMLElement>("[data-seq]")) {
    const top = el.getBoundingClientRect().top;
    if (top >= headerBottom) return { seq: Number(el.dataset.seq), top };
  }
  return { seq: null, top: 0 };
}

function TurnBlock({
  turn,
  lens,
  kids,
  liveTurn,
  fill,
  label,
}: {
  turn: Turn;
  lens: Tier;
  kids: SessionSummary[];
  liveTurn: boolean;
  fill: Fill;
  label: string;
}) {
  const now = useNow();
  const transcript = [...turn.items].reverse().find((i) => i.kind === "event" && i.e.type === "turn.transcript") as
    | Extract<Item, { kind: "event" }>
    | undefined;
  const progress = transcript
    ? undefined
    : ([...turn.items].reverse().find((i) => i.kind === "event" && i.e.type === "turn.progress") as
        | Extract<Item, { kind: "event" }>
        | undefined);
  const ended = turn.items.find((i) => i.kind === "event" && i.e.type === "turn.ended") as
    | Extract<Item, { kind: "event" }>
    | undefined;
  const prompt = (transcript?.e.data.user as string | undefined) ?? (progress?.e.data.user as string | undefined);
  const promptChars = turn.start?.data.prompt_chars as number | undefined;
  const startMs = ms(turn.start?.time);
  const endMs = ms(ended?.e.time);
  const elapsed = ended
    ? ((ended.e.data.ms as number | undefined) ?? endMs - startMs)
    : liveTurn
      ? now - startMs
      : undefined;

  return (
    <li className={`turn ${liveTurn ? "turn--live" : ""} ${turn.n === 0 ? "turn--pre" : ""}`}>
      <header className="turn-head">
        <span className="turn-n">{label}</span>
        {turn.start && <span className="turn-time num">{clock(turn.start.time)}</span>}
        {elapsed !== undefined && <span className="turn-dur num">{dur(elapsed)}</span>}
        {liveTurn && !ended && <Spinner label="turn running" />}
      </header>
      {turn.start &&
        (prompt ? (
          <blockquote className="prompt">
            <Redacted text={prompt} />
          </blockquote>
        ) : (
          <p className="prompt prompt--hidden">
            {promptChars !== undefined ? `a prompt of ${promptChars} chars` : "a prompt"}
          </p>
        ))}
      <ol className="turn-items">
        {turn.items.map((it) => {
          if (it.kind === "tool") return <ToolRow key={it.key} item={it} lens={lens} now={now} fill={fill} />;
          const e = it.e;
          if (e.type === "turn.progress") return null;
          if (e.type === "turn.transcript") {
            if (it !== transcript) return null;
            return (
              <li key={it.key} className="reply" data-seq={e.session.seq}>
                <Redacted text={String(e.data.assistant ?? "")} />
                <Cut e={e} field="assistant" fill={fill} />
              </li>
            );
          }
          if (e.type === "turn.ended") {
            const reason = String(e.data.reason ?? "stop");
            const err = e.data.error as string | undefined;
            return (
              <li
                key={it.key}
                className={`marker marker--end ${reason === "error" ? "is-err" : ""}`}
                data-seq={e.session.seq}
              >
                <span className="marker-time num">{clock(e.time)}</span>
                <span>
                  turn ended · {reason}
                  {err ? ` · ${err}` : ""}
                </span>
              </li>
            );
          }
          if (e.type === "attention.needed") {
            const kind = String(e.data.kind);
            return (
              <li key={it.key} className="marker marker--attn" data-seq={e.session.seq}>
                <span className="marker-time num">{clock(e.time)}</span>
                <span className="marker-kind">{ATTENTION_LABEL[kind] ?? kind}</span>
                {typeof e.data.tool === "string" && <code>{e.data.tool}</code>}
                {typeof e.data.message === "string" && (
                  <span className="marker-msg">
                    <Redacted text={e.data.message} />
                  </span>
                )}
              </li>
            );
          }
          if (e.type === "subagent.started" || e.type === "subagent.ended") {
            const agentId = String(e.data.agent_id ?? "");
            const kid = kids.find((k) => k.id.includes(agentId));
            return (
              <li key={it.key} className="marker marker--agent" data-seq={e.session.seq}>
                <span className="marker-time num">{clock(e.time)}</span>
                <span>
                  ↳ {String(e.data.agent_type ?? "subagent")} {e.type === "subagent.started" ? "started" : "ended"}
                </span>
                {kid && (
                  <Link to={sessionPath(kid.harness, kid.id)} className="marker-link">
                    open ↗
                  </Link>
                )}
              </li>
            );
          }
          return (
            <li key={it.key} className={`marker marker--${e.type.split(".")[0]}`} data-seq={e.session.seq}>
              <span className="marker-time num">{clock(e.time)}</span>
              <span className="marker-type mono">{e.type}</span>
              <span className="marker-msg">
                <Redacted text={eventSummary(e)} />
              </span>
            </li>
          );
        })}
        {progress && String(progress.e.data.assistant ?? "").trim() && (
          <li className="reply reply--live" data-seq={progress.e.session.seq}>
            <Redacted text={String(progress.e.data.assistant)} />
            <span className="caret" aria-hidden="true" />
            <Cut e={progress.e} field="assistant" fill={fill} />
          </li>
        )}
      </ol>
    </li>
  );
}

/** "cut to a preview · N chars · load full" after a slim field. */
function Cut({ e, field, fill }: { e: StoredEvent; field: string; fill: Fill }) {
  const [busy, setBusy] = useState(false);
  const full = e.preview?.[field];
  if (full === undefined) return null;
  return (
    <span className="cut">
      cut to a preview · {full.toLocaleString()} chars ·{" "}
      <button
        type="button"
        className="cut-btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void fill(e).finally(() => setBusy(false));
        }}
      >
        {busy ? "loading…" : "load full"}
      </button>
    </span>
  );
}

function ToolRow({
  item,
  lens,
  now,
  fill,
}: {
  item: Extract<Item, { kind: "tool" }>;
  lens: Tier;
  now: number;
  fill: Fill;
}) {
  const e = item.ended ?? item.started!;
  const tool = String(e.data.tool);
  const running = !item.ended;
  const ok = item.ended ? item.ended.data.ok !== false : undefined;
  const msv = item.ended ? (item.ended.data.ms as number | undefined) : now - ms(item.started?.time);
  const input = lens >= 3 ? (item.ended?.data.input ?? item.started?.data.input) : undefined;
  const output = lens >= 3 ? item.ended?.data.output : undefined;
  const error = item.ended?.data.error as string | undefined;
  const agent = typeof e.data.agent_id === "string";
  const expandable = input !== undefined || output !== undefined || !!error;
  const head = (
    <>
      <span className="tool-time num">{clock((item.started ?? item.ended)!.time)}</span>
      <span
        className={`tool-status ${running ? "is-run" : ok ? "is-ok" : "is-err"}`}
        role="img"
        aria-label={running ? "running" : ok ? "ok" : "error"}
      >
        {running ? <Spinner /> : ok ? "✓" : "✕"}
      </span>
      <code className="tool-name">{tool}</code>
      {agent && <span className="tool-agent">subagent</span>}
      {error && <span className="tool-err ellipsis">{error}</span>}
      <span className="tool-dur num">{dur(msv)}</span>
    </>
  );
  if (!expandable)
    return (
      <li className="tool" data-seq={e.session.seq}>
        {head}
      </li>
    );
  return (
    <li className="tool tool--x" data-seq={e.session.seq}>
      <details>
        <summary>{head}</summary>
        <div className="tool-io">
          {input !== undefined && (
            <div>
              <span className="tool-io-label">input</span>
              <pre>
                <Redacted text={pretty(input)} />
              </pre>
              <Cut e={item.ended?.data.input !== undefined ? item.ended : item.started!} field="input" fill={fill} />
            </div>
          )}
          {output !== undefined && (
            <div>
              <span className="tool-io-label">output</span>
              <pre>
                <Redacted text={pretty(output)} />
              </pre>
              <Cut e={item.ended!} field="output" fill={fill} />
            </div>
          )}
          {error && (
            <div>
              <span className="tool-io-label">error</span>
              <pre className="is-err">
                <Redacted text={error} />
              </pre>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

const pretty = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "preview" in (v as object)) return String((v as { preview: unknown }).preview);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};
