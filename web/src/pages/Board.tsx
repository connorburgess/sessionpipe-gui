// SPDX-License-Identifier: Apache-2.0
// The board: every session grouped by state, needs_you first. Filters by machine,
// harness and text; done sessions collapsed with a count. Empty state points to Connect.
import type { SessionState, SessionSummary } from "@shared/api";
import { SESSION_STATES } from "@shared/api";
import { useMemo, useState } from "react";
import { ChipSelect, SearchInput } from "../components/bits";
import { SessionCard } from "../components/SessionCard";
import { useAppState, useSessionTree } from "../data/hooks";
import { harnessMark, repoBranch, STATE_HEADING, STATE_HINT, sessionTitle } from "../lib/format";
import { useListNav } from "../lib/keys";
import { Link, sessionPath } from "../lib/router";

const matches = (s: SessionSummary, q: string) => {
  if (!q) return true;
  const hay = [
    sessionTitle(s),
    s.cwd,
    repoBranch(s),
    s.machine,
    s.model,
    s.harness,
    s.id,
    s.lastAssistant,
    s.progress?.assistant,
    s.openAttentions.map((a) => a.message).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
};

export function Board() {
  const { roots, childrenOf, all } = useSessionTree();
  const { snapshotAt, connection } = useAppState();
  const [q, setQ] = useState("");
  const [machine, setMachine] = useState("");
  const [harness, setHarness] = useState("");
  const [showDone, setShowDone] = useState(false);

  const machines = useMemo(() => [...new Set(all.map((s) => s.machine).filter((m): m is string => !!m))].sort(), [all]);
  const harnesses = useMemo(() => [...new Set(all.map((s) => s.harness))].sort(), [all]);

  const visible = useMemo(
    () =>
      roots.filter(
        (s) =>
          (!machine || s.machine === machine) &&
          (!harness || s.harness === harness) &&
          (matches(s, q) || (childrenOf.get(s.key) ?? []).some((c) => matches(c, q))),
      ),
    [roots, machine, harness, q, childrenOf],
  );
  const groups = useMemo(() => {
    const g = new Map<SessionState, SessionSummary[]>();
    for (const st of SESSION_STATES) g.set(st, []);
    for (const s of visible) g.get(s.state)!.push(s);
    return g;
  }, [visible]);

  const ordered = useMemo(() => {
    const list: SessionSummary[] = [];
    for (const st of SESSION_STATES) if (st !== "done" || showDone) list.push(...groups.get(st)!);
    return list;
  }, [groups, showDone]);
  const hrefs = useMemo(() => ordered.map((s) => sessionPath(s.harness, s.id)), [ordered]);
  const { cursor } = useListNav(hrefs);
  const cursorKey = ordered[cursor]?.key;

  if (snapshotAt && all.length === 0) return <EmptyBoard />;
  if (!snapshotAt)
    return (
      <p className="page-note">
        {connection === "live" || connection === "connecting"
          ? "Waiting for the first snapshot…"
          : "No connection to the receiver yet."}
      </p>
    );

  const filtered = q || machine || harness;
  const doneCount = groups.get("done")!.length;

  return (
    <div className="page board">
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search sessions" />
        <div className="filters">
          {machines.length > 1 && (
            <ChipSelect value={machine} options={machines} onChange={setMachine} all="all machines" label="Machine" />
          )}
          {harnesses.length > 1 && (
            <ChipSelect
              value={harness}
              options={harnesses.map((h) => h)}
              onChange={setHarness}
              all="all harnesses"
              label="Harness"
            />
          )}
          {filtered && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setQ("");
                setMachine("");
                setHarness("");
              }}
            >
              clear
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 && (
        <p className="page-note">
          Nothing matches{q ? ` “${q}”` : ""}
          {harness ? ` in ${harnessMark(harness).label}` : ""}
          {machine ? ` on ${machine}` : ""}.
        </p>
      )}

      {SESSION_STATES.filter((st) => st !== "done").map((st) => {
        const list = groups.get(st)!;
        if (list.length === 0) return null;
        return (
          <section
            key={st}
            className={`group group--${st}`}
            aria-label={`${list.length} ${STATE_HEADING[st](list.length)}`}
          >
            <header className="group-head">
              <span className="group-count num">{list.length}</span>
              <h2 className="group-title">{STATE_HEADING[st](list.length)}</h2>
              <span className="group-hint">{STATE_HINT[st]}</span>
            </header>
            <div className="grid">
              {list.map((s) => (
                <SessionCard
                  key={s.key}
                  s={s}
                  children={childrenOf.get(s.key)}
                  cursor={s.key === cursorKey ? cursor : undefined}
                />
              ))}
            </div>
          </section>
        );
      })}

      {doneCount > 0 && (
        <section className="group group--done" aria-label={`${doneCount} done`}>
          <header className="group-head group-head--toggle">
            <button
              type="button"
              className="group-toggle"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
            >
              <span className="group-count num">{doneCount}</span>
              <h2 className="group-title">done</h2>
              <span className="group-caret" aria-hidden="true">
                {showDone ? "▾" : "▸"}
              </span>
            </button>
            <span className="group-hint">{STATE_HINT.done}</span>
          </header>
          {showDone && (
            <div className="grid grid--done">
              {groups.get("done")!.map((s) => (
                <SessionCard
                  key={s.key}
                  s={s}
                  children={childrenOf.get(s.key)}
                  cursor={s.key === cursorKey ? cursor : undefined}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function EmptyBoard() {
  return (
    <div className="page empty">
      <p className="empty-kicker">Nothing here yet</p>
      <h1 className="empty-title">Sessions appear the moment an agent fires a hook.</h1>
      <p className="empty-lede">Three ways to get the first one on this board:</p>
      <ol className="empty-ways">
        <li>
          <strong>This machine.</strong> Run <code>npx sessionpipe install</code> once; the GUI tails the local outbox
          with nothing else to configure.
        </li>
        <li>
          <strong>Another machine.</strong> Point its sink here with the one line on the Connect page.
        </li>
        <li>
          <strong>Demo mode.</strong> Synthetic sessions to look around with, on and off from the Connect page.
        </li>
      </ol>
      <Link to="/connect" className="btn btn--primary btn--lg">
        Open Connect
      </Link>
    </div>
  );
}
