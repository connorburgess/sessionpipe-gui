// SPDX-License-Identifier: Apache-2.0
// One session on the board: the title, one line of where it is, one line of what it is
// doing, and the last thing it said. Subagents nest as small rows at the bottom.
import type { SessionFlag, SessionSummary } from "@shared/api";
import { Fragment, memo, type ReactNode, useRef } from "react";
import { ATTENTION_LABEL, modelShort, oneLine, repoBranch, STATE_LABEL, sessionTitle } from "../lib/format";
import { Link, sessionPath } from "../lib/router";
import type { Lens } from "../lib/settings";
import { openSplit } from "../lib/split";
import { HarnessGlyph, Redacted, Since, StateDot } from "./bits";

/** Children joined by a real " · ", so the line reads the same way it looks. */
function Dotted({ children }: { children: ReactNode[] }) {
  const items = children.filter(Boolean);
  return (
    <>
      {items.map((n, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sep"> · </span>}
          {n}
        </Fragment>
      ))}
    </>
  );
}

interface SessionCardProps {
  s: SessionSummary;
  children?: SessionSummary[];
  cursor?: number;
  /** The app-wide tier lens (null = everything): no snippet below 2, no tools or counts below 1. */
  lens?: Lens;
  /** Simple mode: no footer counts. */
  simple?: boolean;
  /** A plain click opens the session beside the page instead of as the page. */
  openBeside?: boolean;
}

/** What the tier lens takes off a card, for the page's "N hidden" line. */
export const cardHides = (s: SessionSummary, lens: Lens): number => {
  if (lens === null) return 0;
  let n = 0;
  if (lens < 2 && (s.progress?.assistant || s.lastAssistant || s.progress?.user || s.lastUser)) n++;
  if (lens < 1 && (s.currentTool || s.counts.tools > 0 || s.openAttentions.some((a) => a.message || a.tool))) n++;
  return n;
};

/** The same summary object, the same children and the same cursor: nothing to redraw.
 *  Every event rebuilds the sessions map, but only the session it belongs to gets a
 *  new summary, so the other cards keep their last render. */
const sameCard = (a: SessionCardProps, b: SessionCardProps): boolean =>
  a.s === b.s &&
  a.cursor === b.cursor &&
  a.lens === b.lens &&
  a.simple === b.simple &&
  a.openBeside === b.openBeside &&
  (a.children?.length ?? 0) === (b.children?.length ?? 0) &&
  (a.children ?? []).every((c, i) => c === b.children?.[i]);

export const SessionCard = memo(function SessionCard({
  s,
  children,
  cursor,
  lens = null,
  simple = false,
  openBeside = false,
}: SessionCardProps) {
  const attention = s.openAttentions[0];
  const live = s.state === "working" || s.state === "needs_you";
  const showText = lens === null || lens >= 2;
  const showTools = lens === null || lens >= 1;
  const liveText = showText
    ? s.progress?.assistant?.trim() ||
      s.lastAssistant?.trim() ||
      (s.progress?.user ? `“${s.progress.user}”` : s.lastUser ? `“${s.lastUser}”` : "")
    : "";
  const isLiveText = !!s.progress?.assistant?.trim();
  const tool = showTools && s.currentTool && s.state === "working" ? s.currentTool : undefined;
  const ref = useRef<HTMLElement>(null);
  const beside = (o: { background: boolean } = { background: false }) =>
    openSplit(s.key, { from: ref.current?.getBoundingClientRect(), background: o.background });
  return (
    <article
      ref={ref}
      className={`card card--${s.state}`}
      data-cursor={cursor !== undefined ? String(cursor) : undefined}
      aria-current={cursor !== undefined ? "true" : undefined}
    >
      <BesideButton onClick={() => beside()} />
      <Link
        to={sessionPath(s.harness, s.id)}
        className="card-link"
        title={sessionTitle(s)}
        modClick={beside}
        plainClick={openBeside ? () => beside() : undefined}
        data-nav-item=""
      >
        <header className="card-head">
          <h3 className="card-title ellipsis">{sessionTitle(s)}</h3>
          {live && (
            <span className="card-elapsed num" title={`Started ${new Date(s.startedAt).toLocaleString()}`}>
              <Since iso={s.startedAt} coarse />
            </span>
          )}
        </header>

        <p className="card-meta ellipsis">
          <Dotted>
            <HarnessGlyph name={s.harness} size="sm" />
            {s.machine && <span>{s.machine}</span>}
            {repoBranch(s) && <span className="mono">{repoBranch(s)}</span>}
            {s.model && <span>{modelShort(s.model)}</span>}
          </Dotted>
        </p>

        <p className="card-status">
          <Dotted>
            <span className="card-state">
              <StateDot state={s.state} decorative />
              {STATE_LABEL[s.state]}
            </span>
            {attention && <span>{ATTENTION_LABEL[attention.kind] ?? attention.kind}</span>}
            {attention?.tool && showTools && <code>{attention.tool}</code>}
            {attention && (
              <span className="num">
                <Since iso={attention.at} />
              </span>
            )}
            {!attention && tool && <code>{tool.tool}</code>}
            {!attention && tool && (
              <span className="num">
                <Since iso={tool.since} />
              </span>
            )}
            {!attention && !tool && !live && (
              <span className="num" title={`Last event ${new Date(s.lastAt).toLocaleString()}`}>
                <Since iso={s.stateSince} coarse />
              </span>
            )}
          </Dotted>
        </p>

        <FlagLine flags={s.flags} className="card-flags" />

        {attention && (
          <p className="card-attn">
            {attention.message && showTools ? <Redacted text={oneLine(attention.message, 240)} /> : "waiting for you"}
          </p>
        )}

        {liveText ? (
          <p className="card-text">
            <Redacted text={oneLine(isLiveText ? tail(liveText, 300) : liveText, 300)} />
          </p>
        ) : null}

        {!simple && (
          <footer className="card-foot num">
            <span>{plural(s.counts.turns, "turn")}</span>
            {showTools && <span>{plural(s.counts.tools, "tool")}</span>}
            {showTools && s.counts.toolErrors > 0 && (
              <span className="is-err">{plural(s.counts.toolErrors, "error")}</span>
            )}
            {showTools && s.counts.filesChanged > 0 && <span>{plural(s.counts.filesChanged, "file")}</span>}
            {showTools && s.children > 0 && <span>{plural(s.children, "subagent")}</span>}
          </footer>
        )}
      </Link>
      {children && children.length > 0 && (
        <ul className="card-kids">
          {children.map((c) => (
            <li key={c.key}>
              <Link to={sessionPath(c.harness, c.id)} className="kid">
                <StateDot state={c.state} decorative />
                <span className="kid-title ellipsis">{sessionTitle(c)}</span>
                {c.currentTool && c.state === "working" ? (
                  <code className="kid-tool">{c.currentTool.tool}</code>
                ) : (
                  <span className="kid-state">{STATE_LABEL[c.state]}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}, sameCard);

/** The store's flags as one muted line: "· 3 tool errors in a row · waiting for 2 events".
 *  Only an error streak is coloured. Renders nothing when there are none. */
export function FlagLine({ flags, className }: { flags: SessionFlag[] | undefined; className: string }) {
  if (!flags?.length) return null;
  return (
    <p className={className}>
      {flags.map((f, i) => (
        <Fragment key={f.kind}>
          <span className="sep">{i > 0 ? " · " : "· "}</span>
          <span className={f.kind === "error_streak" ? "is-err" : undefined}>{f.detail}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** "Open beside": two panes. Shown on hover at a card's or a row's top-right. */
export function BesideButton({ onClick, className = "card-beside" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-label="Open beside"
      title="Open beside (shift+click; ⌘/ctrl+click for a background tab)"
    >
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
        <path d="M11 4v12" />
      </svg>
    </button>
  );
}

const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n + 1)}` : s);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
