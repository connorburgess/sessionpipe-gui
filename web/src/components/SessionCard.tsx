// SPDX-License-Identifier: Apache-2.0
// One session on the board. State first (colour, dot), then what it is, then what it is
// doing right now. Subagents nest as small rows at the bottom.
import type { SessionSummary } from "@shared/api";
import { ATTENTION_LABEL, modelShort, oneLine, repoBranch, sessionTitle } from "../lib/format";
import { Link, sessionPath } from "../lib/router";
import { Chip, HarnessGlyph, Redacted, Since, Spinner, StateDot } from "./bits";

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
  const liveText =
    s.progress?.assistant?.trim() ||
    s.lastAssistant?.trim() ||
    (s.progress?.user ? `“${s.progress.user}”` : s.lastUser ? `“${s.lastUser}”` : "");
  const isLiveText = !!s.progress?.assistant?.trim();
  const dim = s.state === "done";
  return (
    <article
      className={`card card--${s.state}`}
      data-cursor={cursor !== undefined ? String(cursor) : undefined}
      aria-current={cursor !== undefined ? "true" : undefined}
    >
      <Link to={sessionPath(s.harness, s.id)} className="card-link" title={sessionTitle(s)}>
        <header className="card-head">
          <StateDot state={s.state} />
          <h3 className="card-title ellipsis">{sessionTitle(s)}</h3>
          <span className="card-elapsed num" title={`Started ${new Date(s.startedAt).toLocaleString()}`}>
            <Since iso={s.startedAt} coarse />
          </span>
        </header>
        <div className="card-meta">
          <HarnessGlyph name={s.harness} size="sm" />
          {s.model && <span className="card-model ellipsis">{modelShort(s.model)}</span>}
          {s.machine && <Chip kind="machine">{s.machine}</Chip>}
          {repoBranch(s) && <span className="card-repo mono ellipsis">{repoBranch(s)}</span>}
        </div>

        {attention ? (
          <div className="card-attn">
            <span className="card-attn-kind">{ATTENTION_LABEL[attention.kind] ?? attention.kind}</span>
            {attention.tool && <code className="card-attn-tool">{attention.tool}</code>}
            {attention.message ? (
              <p className="card-attn-msg">
                <Redacted text={attention.message} />
              </p>
            ) : (
              <p className="card-attn-msg card-attn-msg--none">waiting for you</p>
            )}
            <span className="card-attn-since num">
              <Since iso={attention.at} />
            </span>
          </div>
        ) : null}

        {s.currentTool && !dim ? (
          <div className="card-now">
            <Spinner />
            <code className="card-now-tool">{s.currentTool.tool}</code>
            <span className="card-now-dur num">
              <Since iso={s.currentTool.since} />
            </span>
          </div>
        ) : null}

        {liveText ? (
          <p className={`card-text ${isLiveText ? "card-text--live" : ""}`}>
            <Redacted text={oneLine(isLiveText ? tail(liveText, 300) : liveText, 300)} />
          </p>
        ) : null}

        <footer className="card-foot num">
          <span>{plural(s.counts.turns, "turn")}</span>
          <span>{plural(s.counts.tools, "tool")}</span>
          {s.counts.toolErrors > 0 && <span className="card-foot-err">{plural(s.counts.toolErrors, "error")}</span>}
          {s.counts.filesChanged > 0 && <span>{plural(s.counts.filesChanged, "file")}</span>}
          {s.children > 0 && <span>{plural(s.children, "subagent")}</span>}
        </footer>
      </Link>
      {children && children.length > 0 && (
        <ul className="card-kids">
          {children.map((c) => (
            <li key={c.key}>
              <Link to={sessionPath(c.harness, c.id)} className="kid">
                <StateDot state={c.state} size={7} />
                <span className="kid-title ellipsis">{sessionTitle(c)}</span>
                {c.currentTool && c.state === "working" ? (
                  <code className="kid-tool">{c.currentTool.tool}</code>
                ) : (
                  <span className="kid-state">{c.state === "done" ? "done" : c.state.replace("_", " ")}</span>
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
