// SPDX-License-Identifier: Apache-2.0
// The board: every session grouped by state, needs_you first. Filters by machine,
// harness and text; done sessions collapsed with a count. Empty state points to Connect.
import type { SessionState, SessionSummary } from "@shared/api";
import { SESSION_STATES } from "@shared/api";
import { useMemo, useState } from "react";
import { Wordmark } from "../components/Brand";
import { ChipSelect, HarnessGlyph, SearchInput } from "../components/bits";
import { LensChip, LensNote } from "../components/LensChip";
import { PALETTE_KEY } from "../components/Palette";
import { cardHides, SessionCard } from "../components/SessionCard";
import { useAppState, useSessionTree } from "../data/hooks";
import { harnessMark, repoBranch, STATE_HEADING, STATE_HINT, sessionTitle } from "../lib/format";
import { useListNav } from "../lib/keys";
import { Link, sessionPath } from "../lib/router";
import { useAppSettings, useLens } from "../lib/settings";

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
  const lens = useLens();
  const { mode, openSessions } = useAppSettings();
  const simple = mode === "simple";
  const beside = openSessions === "beside";

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
  const keys = useMemo(() => ordered.map((s) => s.key), [ordered]);
  const { cursor } = useListNav(hrefs, true, keys);
  const cursorKey = ordered[cursor]?.key;
  const hiddenByLens = useMemo(() => ordered.reduce((n, s) => n + cardHides(s, lens), 0), [ordered, lens]);

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
        <SearchInput value={q} onChange={setQ} placeholder={`Search sessions · ${PALETTE_KEY} for everything`} />
        <LensChip />
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
              optionLabel={(h) => harnessMark(h).label}
              icon={(h) => <HarnessGlyph name={h} size="sm" />}
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

      <LensNote lens={lens} hidden={hiddenByLens} />

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
            <h2 className="group-head" title={STATE_HINT[st]}>
              {STATE_HEADING[st](list.length)}
              <span className="group-count num">{list.length}</span>
            </h2>
            <div className="grid">
              {list.map((s) => (
                <SessionCard
                  key={s.key}
                  s={s}
                  children={childrenOf.get(s.key)}
                  cursor={s.key === cursorKey ? cursor : undefined}
                  lens={lens}
                  simple={simple}
                  openBeside={beside}
                />
              ))}
            </div>
          </section>
        );
      })}

      {doneCount > 0 && (
        <section className="group group--done" aria-label={`${doneCount} done`}>
          <h2 className="group-head">
            <button
              type="button"
              className="group-toggle"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              title={STATE_HINT.done}
            >
              Done
              <span className="group-count num">{doneCount}</span>
              <span className="group-caret" aria-hidden="true">
                {showDone ? "▾" : "▸"}
              </span>
            </button>
          </h2>
          {showDone && (
            <div className="grid grid--done">
              {groups.get("done")!.map((s) => (
                <SessionCard
                  key={s.key}
                  s={s}
                  children={childrenOf.get(s.key)}
                  cursor={s.key === cursorKey ? cursor : undefined}
                  lens={lens}
                  simple={simple}
                  openBeside={beside}
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
      <Wordmark />
      <h1 className="empty-title">Nothing here yet</h1>
      <p className="empty-lede">Sessions appear the moment an agent fires a hook. Three ways to get the first one:</p>
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
