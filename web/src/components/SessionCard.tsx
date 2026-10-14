// SPDX-License-Identifier: Apache-2.0
// One session on the board: the title, one line of where it is, one line of what it is
// doing, and the last thing it said. Subagents nest as small rows at the bottom.
import type { SessionSummary } from "@shared/api";
import { Fragment, type ReactNode } from "react";
import { ATTENTION_LABEL, modelShort, oneLine, repoBranch, STATE_LABEL, sessionTitle } from "../lib/format";
import { Link, sessionPath } from "../lib/router";
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

export function SessionCard({
  s,
  children,
  cursor,
}: {
  s: SessionSummary;
  children?: SessionSummary[];
  cursor?: number;
}) {
  const attention = s.openAttentions[0];
  const live = s.state === "working" || s.state === "needs_you";
  const liveText =
    s.progress?.assistant?.trim() ||
    s.lastAssistant?.trim() ||
    (s.progress?.user ? `“${s.progress.user}”` : s.lastUser ? `“${s.lastUser}”` : "");
  const isLiveText = !!s.progress?.assistant?.trim();
  const tool = s.currentTool && s.state === "working" ? s.currentTool : undefined;
  return (
    <article
      className={`card card--${s.state}`}
      data-cursor={cursor !== undefined ? String(cursor) : undefined}
      aria-current={cursor !== undefined ? "true" : undefined}
    >
      <Link to={sessionPath(s.harness, s.id)} className="card-link" title={sessionTitle(s)}>
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
            {attention?.tool && <code>{attention.tool}</code>}
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

        {attention && (
          <p className="card-attn">
            {attention.message ? <Redacted text={oneLine(attention.message, 240)} /> : "waiting for you"}
          </p>
        )}

        {liveText ? (
          <p className="card-text">
            <Redacted text={oneLine(isLiveText ? tail(liveText, 300) : liveText, 300)} />
          </p>
        ) : null}

        <footer className="card-foot num">
          <span>{plural(s.counts.turns, "turn")}</span>
          <span>{plural(s.counts.tools, "tool")}</span>
          {s.counts.toolErrors > 0 && <span className="is-err">{plural(s.counts.toolErrors, "error")}</span>}
          {s.counts.filesChanged > 0 && <span>{plural(s.counts.filesChanged, "file")}</span>}
          {s.children > 0 && <span>{plural(s.children, "subagent")}</span>}
        </footer>
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
}

const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n + 1)}` : s);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
