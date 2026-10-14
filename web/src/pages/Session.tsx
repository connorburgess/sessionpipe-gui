// SPDX-License-Identifier: Apache-2.0
// One session: a sticky header with its facts, then the timeline grouped by turn, fed by
// GET /api/ui/sessions/:harness/:id in pages and then by the live stream. The tier lens
// hides what a lower-tier receiver would never have got.
import type { Attention, SessionSummary, StoredEvent, Tier } from "@shared/api";
import { sessionKey } from "@shared/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chip, HarnessGlyph, Redacted, Segmented, Since, Spinner, StateBadge, TierBadge } from "../components/bits";
import { ControlStrip } from "../components/ControlStrip";
import { plural } from "../components/SessionCard";
import { useAppState, useStore } from "../data/hooks";
import { ATTENTION_LABEL, eventSummary, modelShort, repoBranch, sessionTitle } from "../lib/format";
import { back, Link, navigate, sessionPath } from "../lib/router";
import { atTier, TIER_HINT, TIER_LABEL } from "../lib/tier";
import { clock, dur, ms, useNow } from "../lib/time";

const PAGE = 500;

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

export function SessionPage({ harness, id }: { harness: string; id: string }) {
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
  const endRef = useRef<HTMLDivElement>(null);

  // Load every page, then let the stream append.
  useEffect(() => {
    let cancelled = false;
    lastSeq.current = -1;
    setEvents([]);
    setLoading(true);
    setError(null);
    const buffered: StoredEvent[] = [];
    const unsub = store.onEvent((e) => {
      if (`${e.harness.name}:${e.session.id}` === key) buffered.push(e);
    });
    (async () => {
      try {
        let after: number | undefined;
        let acc: StoredEvent[] = [];
        for (let i = 0; i < 200; i++) {
          const d = await store.transport.session(harness, id, { after, limit: PAGE });
          if (cancelled) return;
          acc = acc.concat(d.events);
          setSummary(d.session);
          setChildren(d.children);
          setTotal(d.total);
          const last = d.events[d.events.length - 1];
          if (!last || d.events.length < PAGE) break;
          after = last.session.seq;
        }
        const seen = new Set(acc.map((e) => e.session.seq));
        for (const e of buffered) if (!seen.has(e.session.seq)) acc.push(e);
        acc.sort((a, b) => a.session.seq - b.session.seq);
        lastSeq.current = acc[acc.length - 1]?.session.seq ?? -1;
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
      setTotal((t) => t + 1);
    });
  }, [store, key, loading]);

  const s = live ?? summary;
  useEffect(() => {
    if (s) setLens((l) => (l === 3 && s.maxTier < 3 ? s.maxTier : l));
    // only when the session first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.key]);

  const visible = useMemo(
    () => events.map((e) => atTier(e, lens)).filter((e): e is StoredEvent => e !== null),
    [events, lens],
  );
  const turns = useMemo(() => groupTurns(visible), [visible]);
  const hidden = events.length - visible.length;

  // Auto-follow: stick to the bottom while live and the person has not scrolled up.
  const isLive = !!s && (s.state === "working" || s.state === "needs_you");
  useEffect(() => {
    if (!follow || !isLive) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [follow, isLive, events.length]);
  useEffect(() => {
    if (!follow) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 120;
      if (y < lastY - 24 && !atBottom) setFollow(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [follow]);

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
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setForgetting(false);
      setConfirm(false);
    }
  }, [store, harness, id, key]);

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
  const attention: Attention | undefined = s.openAttentions[0];
  const kids = children.length ? children : childrenFromStore(store, key);

  return (
    <div className="page session">
      <header className="sess-head">
        <div className="sess-head-row">
          <button type="button" className="back" onClick={() => back("/")} aria-label="Back">
            ←
          </button>
          <HarnessGlyph name={s.harness} />
          <h1 className="sess-title">{sessionTitle(s)}</h1>
          <StateBadge state={s.state} since={s.stateSince} />
        </div>
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
        {turns.map((t) => (
          <TurnBlock
            key={t.n}
            turn={t}
            lens={lens}
            kids={kids}
            liveTurn={s.currentTurn ? t === turns[turns.length - 1] : false}
            fill={fill}
          />
        ))}
        {loading && (
          <li className="page-note">
            <Spinner /> loading {events.length} of {total}…
          </li>
        )}
        {!loading && visible.length === 0 && <li className="page-note">No events at this tier.</li>}
      </ol>
      <div ref={endRef} />

      <div className="sess-ctl">
        <ControlStrip session={s} control={control} attention={attention} />
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

function TurnBlock({
  turn,
  lens,
  kids,
  liveTurn,
  fill,
}: {
  turn: Turn;
  lens: Tier;
  kids: SessionSummary[];
  liveTurn: boolean;
  fill: Fill;
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
        <span className="turn-n">{turn.n === 0 ? "session" : `turn ${turn.n}`}</span>
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
              <li key={it.key} className="reply">
                <Redacted text={String(e.data.assistant ?? "")} />
                <Cut e={e} field="assistant" fill={fill} />
              </li>
            );
          }
          if (e.type === "turn.ended") {
            const reason = String(e.data.reason ?? "stop");
            const err = e.data.error as string | undefined;
            return (
              <li key={it.key} className={`marker marker--end ${reason === "error" ? "is-err" : ""}`}>
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
              <li key={it.key} className="marker marker--attn">
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
              <li key={it.key} className="marker marker--agent">
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
            <li key={it.key} className={`marker marker--${e.type.split(".")[0]}`}>
              <span className="marker-time num">{clock(e.time)}</span>
              <span className="marker-type mono">{e.type}</span>
              <span className="marker-msg">
                <Redacted text={eventSummary(e)} />
              </span>
            </li>
          );
        })}
        {progress && String(progress.e.data.assistant ?? "").trim() && (
          <li className="reply reply--live">
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
  if (!expandable) return <li className="tool">{head}</li>;
  return (
    <li className="tool tool--x">
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
          {error && input === undefined && output === undefined && (
            <div>
              <span className="tool-io-label">error</span>
              <pre>{error}</pre>
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
