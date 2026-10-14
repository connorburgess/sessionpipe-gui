// SPDX-License-Identifier: Apache-2.0
// The office: one room per machine, one desk per live session, a helper per live
// subagent. Facts come from the store through useSessionTree/useAppState; postures from
// themes/posture.ts; seating is stable per session. This file composes and budgets.
import type { SessionKey, SessionSummary } from "@shared/api";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAppState, useSessionTree } from "../../data/hooks";
import { useListNav } from "../../lib/keys";
import { Link, sessionPath } from "../../lib/router";
import { useNow } from "../../lib/time";
import {
  BREATHE_UNTIL,
  derivePosture,
  hourBand,
  MAX_TYPING,
  type Phase,
  type Posture,
  reserveWalk,
  useMediaQuery,
  useSeating,
} from "../posture";
import { Legend } from "./Legend";
import { OfficeDefs } from "./parts";
import { Room, type RoomCell } from "./Room";
import "../themes.css";
import "./office.css";

const UNNAMED = "unnamed";
const ARRIVE_MS = 1500;
const LEAVE_MS = 1100;
const MAX_ROWS = 4;

const roomOf = (s: SessionSummary) => s.machine || UNNAMED;

function usePageHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      document.addEventListener("visibilitychange", l);
      return () => document.removeEventListener("visibilitychange", l);
    },
    () => document.hidden,
    () => false,
  );
}

/** Sessions that just left the live set, kept for the walk out. */
function useLeaving(live: ReadonlyMap<SessionKey, SessionSummary>) {
  const [leaving, setLeaving] = useState<ReadonlyMap<SessionKey, SessionSummary>>(new Map());
  const prev = useRef<ReadonlyMap<SessionKey, SessionSummary>>(new Map());
  useEffect(() => {
    const gone = [...prev.current.values()].filter((s) => !live.has(s.key));
    prev.current = live;
    if (gone.length === 0) return;
    setLeaving((m) => new Map([...m, ...gone.map((s) => [s.key, s] as const)]));
    const t = setTimeout(() => {
      setLeaving((m) => {
        const n = new Map(m);
        for (const s of gone) n.delete(s.key);
        return n;
      });
    }, LEAVE_MS);
    return () => clearTimeout(t);
  }, [live]);
  return leaving;
}

const midnight = (at: number) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function OfficePage() {
  const { roots, childrenOf, all } = useSessionTree();
  const { machines, snapshotAt, connection } = useAppState();
  const now = useNow();
  const narrow = useMediaQuery("(max-width: 480px)");
  const hidden = usePageHidden();
  const [legend, setLegend] = useState(false);

  const live = useMemo(() => roots.filter((s) => s.state !== "done" && !s.backfilled), [roots]);
  const liveMap = useMemo(() => new Map(live.map((s) => [s.key, s] as const)), [live]);
  const leaving = useLeaving(liveMap);

  // rooms, in name order; sessions with no machine share the last one
  const roomNames = useMemo(() => {
    const names = new Set<string>([...machines.keys()]);
    for (const s of all) if (s.machine) names.add(s.machine);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    if (all.some((s) => !s.machine)) sorted.push(UNNAMED);
    return sorted;
  }, [machines, all]);

  const occupied = useMemo(
    () =>
      roomNames.map((room) => ({
        room,
        keys: [
          ...live.filter((s) => roomOf(s) === room).map((s) => s.key),
          ...[...leaving.values()].filter((s) => roomOf(s) === room).map((s) => s.key),
        ],
      })),
    [roomNames, live, leaving],
  );
  const slots = useSeating(occupied);

  // arrivals: first seen after the first snapshot walk in (within the calm budget)
  const seen = useRef(new Map<SessionKey, { at: number; walk: boolean }>());
  const booted = useRef(false);
  for (const s of live) {
    if (!seen.current.has(s.key)) {
      const t = Date.now();
      seen.current.set(s.key, booted.current ? { at: t, walk: reserveWalk(t) } : { at: 0, walk: false });
    }
  }
  for (const k of [...seen.current.keys()]) if (!liveMap.has(k) && !leaving.has(k)) seen.current.delete(k);
  useEffect(() => {
    if (snapshotAt) booted.current = true;
  }, [snapshotAt]);

  // postures, with the typing budget (newest progress keeps typing)
  const postures = useMemo(() => {
    const out = new Map<SessionKey, Posture>();
    for (const s of live) {
      const entry = seen.current.get(s.key);
      const phase: Phase = entry && entry.at > 0 && now - entry.at < ARRIVE_MS ? "arriving" : "seated";
      out.set(s.key, derivePosture(s, childrenOf.get(s.key), now, phase));
    }
    for (const s of leaving.values()) out.set(s.key, derivePosture(s, undefined, now, "leaving"));
    const typing = [...out.entries()].filter(([, p]) => p.typing);
    if (typing.length > MAX_TYPING) {
      typing.sort((a, b) =>
        (liveMap.get(b[0])?.progress?.at ?? "").localeCompare(liveMap.get(a[0])?.progress?.at ?? ""),
      );
      for (const [k, p] of typing.slice(MAX_TYPING)) out.set(k, { ...p, typing: false });
    }
    return out;
  }, [live, leaving, childrenOf, now, liveMap]);

  // keyboard order: rooms, then slots, then each desk's helpers
  const maxCols = narrow ? 3 : 6;
  const rooms = useMemo(() => {
    const hrefs: string[] = [];
    const since = midnight(now);
    const list = roomNames.map((name) => {
      const here = [...live, ...leaving.values()].filter((s) => roomOf(s) === name);
      const cols = Math.max(2, Math.min(here.length, maxCols));
      const maxSlot = here.reduce((m, s) => Math.max(m, slots.get(s.key) ?? 0), 0);
      const rows = Math.max(1, Math.min(MAX_ROWS, Math.ceil((maxSlot + 1) / cols)));
      const cells: RoomCell[] = here
        .map((s) => ({
          s,
          p: postures.get(s.key)!,
          slot: slots.get(s.key) ?? 0,
          walk: seen.current.get(s.key)?.walk ?? false,
        }))
        .sort((a, b) => a.slot - b.slot)
        .map((c) => {
          if (c.slot >= cols * rows) return c;
          const index = hrefs.length;
          hrefs.push(sessionPath(c.s.harness, c.s.id));
          const helperBase = hrefs.length;
          for (const h of c.p.helpers) hrefs.push(sessionPath(h.harness, h.id));
          return { ...c, index, helperBase };
        });
      const gone = all.filter(
        (s) =>
          s.state === "done" &&
          !s.backfilled &&
          !s.parentId &&
          roomOf(s) === name &&
          Date.parse(s.endedAt ?? s.stateSince) >= since,
      ).length;
      return { name, machine: machines.get(name), cells, cols, rows, gone };
    });
    return { list, hrefs };
  }, [roomNames, live, leaving, slots, postures, maxCols, machines, all, now]);

  const { cursor } = useListNav(rooms.hrefs);
  const needs = live.filter((s) => s.state === "needs_you").length;
  const working = live.filter((s) => s.state === "working").length;
  const figures = live.length + [...childrenOf.values()].flat().filter((c) => c.state !== "done").length;

  useEffect(() => {
    const t = setTimeout(() => {
      document.title = `${needs > 0 ? `(${needs}) ` : ""}Office · sessionpipe`;
    }, 0);
    return () => clearTimeout(t);
  }, [needs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "?" || e.metaKey || e.ctrlKey || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
      e.preventDefault();
      setLegend((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const band = hourBand(now);

  if (!snapshotAt)
    return (
      <p className="page-note">
        {connection === "live" || connection === "connecting"
          ? "Waiting for the first snapshot…"
          : "No connection to the receiver yet."}
      </p>
    );

  const summary = [
    needs > 0 ? `${needs} need${needs === 1 ? "s" : ""} you` : "",
    working > 0 ? `${working} working` : "",
    live.length - needs - working > 0 ? `${live.length - needs - working} idle or stale` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const classes = ["page", "office", hidden ? "office--paused" : "", figures > BREATHE_UNTIL ? "office--crowded" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <OfficeDefs />
      <header className="office-head">
        <h1 className="office-title">Office</h1>
        <span className="office-xp">experimental</span>
        <span className="office-sum">{summary || (roomNames.length ? "nobody is in right now" : "")}</span>
        <Legend open={legend} onToggle={() => setLegend((v) => !v)} />
      </header>

      {roomNames.length === 0 ? (
        <EmptyOffice band={band} />
      ) : (
        <div className="rooms">
          {rooms.list.map((r) => (
            <Room
              key={r.name}
              name={r.name}
              machine={r.machine}
              cells={r.cells}
              cols={r.cols}
              rows={r.rows}
              gone={r.gone}
              band={band}
              now={now}
              cursor={cursor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyOffice({ band }: { band: ReturnType<typeof hourBand> }) {
  return (
    <div className="office-empty">
      <Room name="no machines yet" cells={[]} cols={2} rows={1} gone={0} band={band} now={0} />
      <ul className="office-ways">
        <li>
          <strong>This machine.</strong> Run <code>npx sessionpipe install</code> once; the GUI tails the local outbox.
        </li>
        <li>
          <strong>Another machine.</strong> Point its sink here with the one line on the Connect page.
        </li>
        <li>
          <strong>Demo mode.</strong> Synthetic sessions to look around with, on and off from Connect.
        </li>
      </ul>
      <Link to="/connect" className="btn btn--primary">
        Open Connect
      </Link>
    </div>
  );
}
