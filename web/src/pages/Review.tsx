// SPDX-License-Identifier: Apache-2.0
// Review: looking back over what the protocol already recorded. A search over transcripts,
// tool names, changed paths and titles (GET /api/ui/search; a hit opens the session beside
// at that turn), then two tabs: the files changed in a range grouped by repo, and a day's
// digest as one table with totals per machine and per repo.
import type { Digest, DigestGroup, FilesPage, SearchHit, SearchPage } from "@shared/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HarnessGlyph, Redacted, SearchInput, Segmented, Spinner } from "../components/bits";
import { useStore } from "../data/hooks";
import { repoShort } from "../lib/format";
import { openSplit } from "../lib/split";
import { ago, clock, dayLabel, durCoarse, useNow } from "../lib/time";

const PAGE = 50;
const DAY_MS = 86_400_000;

/** Opens a session beside the page at one of its rows: the panel reads `#seq-N` once
 *  (components/SessionView.tsx) and scrolls there instead of to the latest turn. */
function openAt(key: string, seq: number | undefined, from?: DOMRect) {
  openSplit(key, { from });
  if (seq === undefined) return;
  history.replaceState(null, "", `${location.pathname}${location.search}#seq-${seq}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** The browser's local day as YYYY-MM-DD, and its UTC offset in minutes (getTimezoneOffset's sign). */
const tzOffset = () => new Date().getTimezoneOffset();
const localDay = (ms: number) => new Date(ms - tzOffset() * 60_000).toISOString().slice(0, 10);
const shiftDay = (day: string, days: number) => localDay(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS);
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function Review() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"files" | "day">("files");
  const needle = q.trim();
  return (
    <div className="page review">
      <p className="rv-lead">
        Look back: find a word in any session, see which files your agents changed, or read one day as a digest. The
        Board is now; this is what happened.
      </p>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Search transcripts, tools and file paths" />
      </div>
      {needle && <Hits q={needle} />}
      <div className="rv-tabs" role="tablist" aria-label="Review">
        <button
          type="button"
          role="tab"
          id="rv-tab-files"
          className="rv-tab"
          aria-selected={tab === "files"}
          aria-controls="rv-panel"
          onClick={() => setTab("files")}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          id="rv-tab-day"
          className="rv-tab"
          aria-selected={tab === "day"}
          aria-controls="rv-panel"
          onClick={() => setTab("day")}
        >
          Day
        </button>
      </div>
      <div id="rv-panel" role="tabpanel" aria-labelledby={tab === "files" ? "rv-tab-files" : "rv-tab-day"}>
        {tab === "files" ? <FilesView /> : <DayView />}
      </div>
    </div>
  );
}

// ---------- search ----------

function Hits({ q }: { q: string }) {
  const store = useStore();
  const [page, setPage] = useState<SearchPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    const t = setTimeout(() => {
      store.transport
        .search({ q, limit: PAGE })
        .then((p) => !cancelled && setPage(p))
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
        .finally(() => !cancelled && setBusy(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [store, q]);

  const more = useCallback(() => {
    if (!page?.cursor) return;
    setBusy(true);
    store.transport
      .search({ q, limit: PAGE, before: page.cursor })
      .then((p) =>
        setPage((prev) => (prev ? { ...p, hits: [...prev.hits, ...p.hits], scanned: prev.scanned + p.scanned } : p)),
      )
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [store, q, page]);

  const now = useNow();
  const shown = page && page.q === q ? page : null;
  let lastDay = "";
  return (
    <section className="review-search" aria-label="Search results">
      {error && <p className="page-note is-err">{error}</p>}
      <ol className="rows review-hits" aria-busy={busy}>
        {shown?.hits.map((h, i) => {
          const day = dayLabel(h.event.time, now);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <li key={h.event.id} className="ev-row" data-cursor={String(i)}>
              {showDay && <span className="ev-day">{day}</span>}
              <HitRow hit={h} index={i} />
            </li>
          );
        })}
      </ol>
      {shown && !busy && shown.hits.length === 0 && <p className="page-note">Nothing matches “{q}”.</p>}
      {busy && (
        <p className="page-note">
          <Spinner /> searching…
        </p>
      )}
      {shown && (
        <p className="page-note">
          <span className="review-meta num">
            {shown.hits.length} {shown.hits.length === 1 ? "hit" : "hits"} · {shown.scanned.toLocaleString()} events
            looked at · {shown.ms} ms
          </span>
          {shown.cursor && !busy && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={more}>
              Older hits
            </button>
          )}
        </p>
      )}
    </section>
  );
}

/** One hit: time, harness, session, where it matched, the snippet with the match marked. */
function HitRow({ hit, index }: { hit: SearchHit; index: number }) {
  const { session: s, event: e, snippet, match } = hit;
  const title = s.title?.trim() || (s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() : undefined) || s.id.slice(0, 8);
  return (
    <button
      type="button"
      className="hit"
      title={`Open ${title} beside, at this ${hit.field === "title" ? "session" : "turn"}`}
      onClick={() =>
        openAt(s.key, e.session.seq, document.querySelector(`[data-cursor="${index}"]`)?.getBoundingClientRect())
      }
    >
      <span className="hit-time num" title={new Date(e.time).toLocaleString()}>
        {clock(e.time)}
      </span>
      <HarnessGlyph name={e.harness.name} size="sm" />
      <span className="hit-session ellipsis">
        {title}
        {s.machine && <span className="rv-span">{s.machine}</span>}
      </span>
      <span className="hit-field">
        {hit.field === "user" ? "prompt" : hit.field === "assistant" ? "reply" : hit.field}
      </span>
      <span className="hit-snippet ellipsis">
        <Redacted text={snippet.slice(0, match[0])} />
        <mark>{snippet.slice(match[0], match[1])}</mark>
        <Redacted text={snippet.slice(match[1])} />
      </span>
    </button>
  );
}

// ---------- files ----------

type Range = "today" | "7d" | "30d";
const RANGE_SINCE: Record<Range, () => number> = {
  today: startOfToday,
  "7d": () => Date.now() - 7 * DAY_MS,
  "30d": () => Date.now() - 30 * DAY_MS,
};

function FilesView() {
  const store = useStore();
  const [range, setRange] = useState<Range>("today");
  const [page, setPage] = useState<FilesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const now = useNow();

  // A files.changed on the stream refreshes the view (a moment later, so a burst is one fetch).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = store.onEvent((e) => {
      if (e.type !== "files.changed") return;
      if (t) clearTimeout(t);
      t = setTimeout(() => setTick((n) => n + 1), 1500);
    });
    return () => {
      unsub();
      if (t) clearTimeout(t);
    };
  }, [store]);

  useEffect(() => {
    let cancelled = false;
    const since = new Date(RANGE_SINCE[range]()).toISOString();
    store.transport
      .files({ since })
      .then((p) => !cancelled && setPage(p))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [store, range, tick]);

  return (
    <div className="page rv-files">
      <div className="rv-head">
        <Segmented<Range>
          value={range}
          onChange={setRange}
          label="Range"
          options={[
            { value: "today", label: "today" },
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
          ]}
        />
        {page && (
          <span className="page-note num">
            {page.total} {page.total === 1 ? "path" : "paths"} in {page.repos.length}{" "}
            {page.repos.length === 1 ? "repo" : "repos"}
          </span>
        )}
      </div>
      {error && <p className="page-note is-err">{error}</p>}
      {page && page.repos.length === 0 && (
        <p className="page-note">No files changed in this range. Changed paths arrive with tier 1 and up.</p>
      )}
      {page?.repos.map((r) => (
        <section key={r.repo || "(none)"} className="group rv-repo" aria-label={r.repo ? repoShort(r.repo) : "no repo"}>
          <h2 className="group-head">
            {r.repo ? repoShort(r.repo) : "no repo"}
            <span className="group-count num">
              {r.paths.length} {r.paths.length === 1 ? "path" : "paths"} · {r.sessions}{" "}
              {r.sessions === 1 ? "session" : "sessions"}
            </span>
          </h2>
          <ul className="rv-paths">
            {r.paths.map((p) => (
              <li key={p.path} className="rv-path">
                <code className="rv-file" title={p.path}>
                  {p.path}
                </code>
                <span className="rv-when num" title={new Date(p.lastAt).toLocaleString()}>
                  {ago(p.lastAt, now)}
                  {p.count > 1 ? ` · ×${p.count}` : ""}
                </span>
                <span className="rv-touched">
                  {p.sessions.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="rv-sess"
                      title={`Open ${s.title} beside`}
                      onClick={() => openAt(s.key, undefined)}
                    >
                      {s.title}
                      {s.count > 1 && <span className="num"> ×{s.count}</span>}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- day ----------

function DayView() {
  const store = useStore();
  const [day, setDay] = useState(() => localDay(Date.now()));
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const today = localDay(Date.now());
  const isToday = day === today;

  // Today's digest follows the stream, a few seconds behind.
  useEffect(() => {
    if (!isToday) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = store.onEvent(() => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        setTick((n) => n + 1);
      }, 3000);
    });
    return () => {
      unsub();
      if (t) clearTimeout(t);
    };
  }, [store, isToday]);

  useEffect(() => {
    let cancelled = false;
    store.transport
      .digest({ day, tz: tzOffset() })
      .then((d) => !cancelled && setDigest(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [store, day, tick]);

  const label = useMemo(() => {
    const d = new Date(`${day}T12:00:00`);
    if (isToday) return "today";
    if (day === shiftDay(today, -1)) return "yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }, [day, isToday, today]);

  const shown = digest && digest.day === day ? digest : null;
  return (
    <div className="page rv-day-view">
      <div className="rv-head">
        <span className="rv-stepper">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label="Previous day"
            onClick={() => setDay((d) => shiftDay(d, -1))}
          >
            ‹
          </button>
          <span className="rv-day" aria-live="polite">
            {label}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label="Next day"
            disabled={isToday}
            onClick={() => setDay((d) => shiftDay(d, 1))}
          >
            ›
          </button>
        </span>
        {!isToday && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDay(today)}>
            Today
          </button>
        )}
        {shown && (
          <span className="page-note num">
            {shown.totals.sessions} {shown.totals.sessions === 1 ? "session" : "sessions"} ·{" "}
            {shown.totals.events.toLocaleString()} events · {day}
          </span>
        )}
      </div>
      {error && <p className="page-note is-err">{error}</p>}
      {shown && shown.sessions.length === 0 && <p className="page-note">Nothing happened on {label}.</p>}
      {shown && shown.sessions.length > 0 && (
        <table className="rv-table">
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Machine</th>
              <th scope="col" className="rv-col-wide">
                Repo
              </th>
              <th scope="col" className="num">
                Turns
              </th>
              <th scope="col" className="num">
                Tools
              </th>
              <th scope="col" className="num">
                Errors
              </th>
              <th scope="col" className="num">
                Duration
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.sessions.map((s) => (
              <tr key={s.key}>
                <td>
                  <HarnessGlyph name={s.harness} size="sm" />{" "}
                  <button
                    type="button"
                    className="rv-link"
                    title={`Open ${s.title} beside`}
                    onClick={() => openAt(s.key, undefined)}
                  >
                    {s.title}
                  </button>
                  <span className="rv-span num">
                    {clock(s.startedAt).slice(0, 5)}–{clock(s.endedAt).slice(0, 5)}
                  </span>
                </td>
                <td className="muted">{s.machine ?? ""}</td>
                <td className="mono rv-col-wide">{repoShort(s.repo)}</td>
                <td className="num">{s.turns}</td>
                <td className="num">{s.tools}</td>
                <td className={`num ${s.errors ? "is-err" : "muted"}`}>{s.errors || "–"}</td>
                <td className="num">{durCoarse(s.activeMs)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {shown.byMachine.map((g) => (
              <TotalRow key={`m:${g.name}`} kind="machine" g={g} />
            ))}
            {shown.byRepo.map((g) => (
              <TotalRow key={`r:${g.name}`} kind="repo" g={g} label={g.name ? repoShort(g.name) : "no repo"} />
            ))}
            <TotalRow kind="all" g={shown.totals} label="all" all />
          </tfoot>
        </table>
      )}
    </div>
  );
}

function TotalRow({ kind, g, label, all = false }: { kind: string; g: DigestGroup; label?: string; all?: boolean }) {
  return (
    <tr className={all ? "rv-all" : ""}>
      <td colSpan={3}>
        <span className="rv-kind">{kind}</span>
        {label ?? (g.name || "no machine")}
        <span className="rv-span num">
          {g.sessions} {g.sessions === 1 ? "session" : "sessions"}
          {g.filesTouched ? ` · ${g.filesTouched} ${g.filesTouched === 1 ? "file" : "files"}` : ""}
        </span>
      </td>
      <td className="num">{g.turns}</td>
      <td className="num">{g.tools}</td>
      <td className={`num ${g.errors ? "is-err" : ""}`}>{g.errors || "–"}</td>
      <td className="num">{durCoarse(g.activeMs)}</td>
    </tr>
  );
}
