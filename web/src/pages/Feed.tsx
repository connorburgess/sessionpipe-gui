// SPDX-License-Identifier: Apache-2.0
// The feed: every event as it arrives, newest first, like `sessionpipe tail`. Pages from
// GET /api/ui/events; live rows prepend from the stream unless paused.
import type { FeedQuery, StoredEvent } from "@shared/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChipSelect, HarnessGlyph, Redacted, SearchInput, Spinner } from "../components/bits";
import { BesideButton } from "../components/SessionCard";
import { useAppState, useStore } from "../data/hooks";
import { eventSummary, harnessMark, sessionTitle, storedKey } from "../lib/format";
import { useListNav } from "../lib/keys";
import { Link, sessionPath } from "../lib/router";
import { openSplit } from "../lib/split";
import { clock, dayLabel, useNow } from "../lib/time";

const CAP = 1500;
const TYPES = ["session", "turn", "tool", "files", "attention", "subagent", "context"];

/** Rows are newest first by event time (a backfilled event lands under its own day, not
 *  under today), so a live event goes where its time says, not on top. */
const insertByTime = (rows: StoredEvent[], e: StoredEvent): StoredEvent[] => {
  let i = 0;
  while (i < rows.length && rows[i]!.time > e.time) i++;
  return [...rows.slice(0, i), e, ...rows.slice(i)];
};

const applyFilter = (e: StoredEvent, f: FeedQuery) =>
  (!f.harness || e.harness.name === f.harness) &&
  (!f.machine || e.session.machine === f.machine) &&
  (!f.type || e.type === f.type || e.type.startsWith(`${f.type}.`)) &&
  (!f.session || storedKey(e) === f.session) &&
  (!f.q || JSON.stringify(e).toLowerCase().includes(f.q.toLowerCase()));

export function Feed() {
  const store = useStore();
  const { sessions } = useAppState();
  const [harness, setHarness] = useState("");
  const [machine, setMachine] = useState("");
  const [type, setType] = useState("");
  const [session, setSession] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<StoredEvent[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pending = useRef<StoredEvent[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const filter = useMemo<FeedQuery>(
    () => ({ harness, machine, type, session, q: q.trim() }),
    [harness, machine, type, session, q],
  );
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const harnesses = useMemo(() => [...new Set([...sessions.values()].map((s) => s.harness))].sort(), [sessions]);
  const machines = useMemo(
    () => [...new Set([...sessions.values()].map((s) => s.machine).filter((m): m is string => !!m))].sort(),
    [sessions],
  );
  const sessionOptions = useMemo(() => [...sessions.values()].filter((s) => !s.parentId).map((s) => s.key), [sessions]);
  const sessionLabel = (key: string) => {
    const s = sessions.get(key);
    return s ? sessionTitle(s) : key;
  };

  // (Re)load the first page whenever the filter changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pending.current = [];
    setPendingCount(0);
    const t = setTimeout(() => {
      store.transport
        .feed({ ...filter, limit: 150 })
        .then((p) => {
          if (cancelled) return;
          setRows(p.events);
          setCursor(p.cursor);
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
        .finally(() => !cancelled && setLoading(false));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [store, filter]);

  // Live rows.
  useEffect(
    () =>
      store.onEvent((e) => {
        if (!applyFilter(e, filterRef.current)) return;
        if (paused) {
          pending.current.unshift(e);
          if (pending.current.length > CAP) pending.current.length = CAP;
          setPendingCount(pending.current.length);
          return;
        }
        setRows((prev) => (prev.some((p) => p.id === e.id) ? prev : insertByTime(prev, e).slice(0, CAP)));
      }),
    [store, paused],
  );

  const resume = useCallback(() => {
    const p = pending.current;
    pending.current = [];
    setPendingCount(0);
    setRows((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      return p
        .filter((e) => !seen.has(e.id))
        .reduce(insertByTime, prev)
        .slice(0, CAP);
    });
    setPaused(false);
  }, []);

  const older = useCallback(() => {
    if (!cursor) return;
    setLoading(true);
    store.transport
      .feed({ ...filter, before: cursor, limit: 150 })
      .then((p) => {
        setRows((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          return [...prev, ...p.events.filter((e) => !seen.has(e.id))].slice(0, CAP);
        });
        setCursor(p.cursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [store, filter, cursor]);

  const hrefs = useMemo(() => rows.map((e) => sessionPath(e.harness.name, e.session.id)), [rows]);
  const keys = useMemo(() => rows.map(storedKey), [rows]);
  const { cursor: cur } = useListNav(hrefs, true, keys);
  const now = useNow();

  let lastDay = "";
  return (
    <div className="page feed">
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search events" />
        <div className="filters">
          <ChipSelect
            value={harness}
            options={harnesses}
            onChange={setHarness}
            all="all harnesses"
            label="Harness"
            optionLabel={(h) => harnessMark(h).label}
            icon={(h) => <HarnessGlyph name={h} size="sm" />}
          />
          <ChipSelect value={machine} options={machines} onChange={setMachine} all="all machines" label="Machine" />
          <ChipSelect value={type} options={TYPES} onChange={setType} all="all types" label="Type" />
          <label className={`chipsel ${session ? "chipsel-on" : ""}`}>
            <select value={session} onChange={(e) => setSession(e.target.value)} aria-label="Session">
              <option value="">all sessions</option>
              {sessionOptions.map((k) => (
                <option key={k} value={k}>
                  {sessionLabel(k)}
                </option>
              ))}
            </select>
            <span className="chipsel-text ellipsis">{session ? sessionLabel(session) : "all sessions"}</span>
            <span aria-hidden="true" className="chipsel-caret">
              ▾
            </span>
          </label>
          <button
            type="button"
            className={`btn btn--sm feed-pause ${paused ? "btn--on" : "btn--ghost"}`}
            aria-pressed={paused}
            onClick={() => (paused ? resume() : setPaused(true))}
          >
            {paused ? "Resume" : "Pause"}
            {paused && pendingCount > 0 && <span className="pill-new num">{pendingCount} new</span>}
          </button>
        </div>
      </div>

      {error && <p className="page-note is-err">{error}</p>}

      <ol className="rows" aria-busy={loading}>
        {rows.map((e, i) => {
          const day = dayLabel(e.time, now);
          const showDay = day !== lastDay;
          lastDay = day;
          const s = sessions.get(storedKey(e));
          return (
            <li
              key={e.id}
              className={`ev ev--${e.type.split(".")[0]}`}
              data-cursor={String(i)}
              aria-current={i === cur ? "true" : undefined}
            >
              {showDay && <span className="ev-day">{day}</span>}
              <span className="ev-time num" title={new Date(e.time).toLocaleString()}>
                {clock(e.time)}
              </span>
              <HarnessGlyph name={e.harness.name} size="sm" />
              <Link
                to={sessionPath(e.harness.name, e.session.id)}
                className="ev-session ellipsis"
                title={e.session.id}
                modClick={(o) =>
                  openSplit(storedKey(e), {
                    from: document.querySelector(`[data-cursor="${i}"]`)?.getBoundingClientRect(),
                    background: o.background,
                  })
                }
              >
                {s ? sessionTitle(s) : (e.session.title ?? e.session.id.slice(0, 8))}
              </Link>
              {e.session.machine && <span className="ev-machine ellipsis">{e.session.machine}</span>}
              <span className={`ev-type mono ev-type--${e.type.split(".")[0]}`}>{e.type}</span>
              <span className="ev-sum ellipsis">
                <Redacted text={eventSummary(e)} />
              </span>
              <span className="ev-tier num" title={`tier ${e.tier} · ${e.source}`}>
                t{e.tier}
              </span>
              <BesideButton
                className="ev-beside"
                onClick={() =>
                  openSplit(storedKey(e), {
                    from: document.querySelector(`[data-cursor="${i}"]`)?.getBoundingClientRect(),
                  })
                }
              />
            </li>
          );
        })}
      </ol>
      {loading && (
        <p className="page-note">
          <Spinner /> loading…
        </p>
      )}
      {!loading && rows.length === 0 && <p className="page-note">No events match.</p>}
      {!loading && cursor && (
        <button type="button" className="btn btn--ghost more" onClick={older}>
          Older events
        </button>
      )}
      {rows.length >= CAP && <p className="page-note">Showing the newest {CAP}; narrow the filter for more.</p>}
    </div>
  );
}
