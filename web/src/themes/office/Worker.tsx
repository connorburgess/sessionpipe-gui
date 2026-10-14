// SPDX-License-Identifier: Apache-2.0
// One desk cell (96 × 80): the seated figure in its posture, the screen, the lamp, the
// error sheets, the helpers standing to the right, and the walk in or out. The cell is
// a link to the session; hover or focus shows the tooltip. Only `Posture` decides what
// is drawn (DESIGN.md §2, §3); this file is drawings and placement.
import type { SessionSummary } from "@shared/api";
import { type CSSProperties, memo } from "react";
import { Redacted } from "../../components/bits";
import { ATTENTION_LABEL, harnessMark, modelShort, repoBranch, STATE_LABEL, sessionTitle } from "../../lib/format";
import { Link, sessionPath } from "../../lib/router";
import { durShort, since } from "../../lib/time";
import { cutLeft, type Posture, screenText } from "../posture";
import { CELL_H, CELL_W, FIGURE_X } from "./parts";

/** The door's centre line, in room-content coordinates (DESIGN.md §1: 18 px gap at x = 16). */
export const DOOR_X = 16 + 9;
export const ROOM_PAD = 12;

export interface CellProps {
  s: SessionSummary;
  p: Posture;
  slot: number;
  col: number;
  row: number;
  now: number;
  /** Arriving: walk from the door, or fade in when the calm budget is spent. */
  walk: boolean;
  cursor?: number;
  helperCursor?: (i: number) => number | undefined;
}

const plural = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? "" : "s"}` : "");

export const Cell = memo(function Cell({ s, p, slot, col, row, now, walk, cursor, helperCursor }: CellProps) {
  const title = sessionTitle(s);
  const mark = harnessMark(s.harness);
  const dx = DOOR_X - (ROOM_PAD + col * CELL_W + FIGURE_X);
  const dy = row * CELL_H;
  const style = {
    "--col": col,
    "--row": row,
    "--slot4": slot % 4,
    "--dx": `${dx}px`,
    "--dy": `${dy}px`,
  } as CSSProperties;
  const label = [title, STATE_LABEL[p.state], p.tool ?? (p.attention ? ATTENTION_LABEL[p.attention.kind] : "")]
    .filter(Boolean)
    .join(", ");
  const front = cutLeft(repoBranch(s), 10);
  const classes = ["cell", `cell--${p.state}`, `cell--${p.phase}`, walk ? "" : "cell--nowalk"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} style={style} data-cursor={cursor !== undefined ? String(cursor) : undefined}>
      <Link to={sessionPath(s.harness, s.id)} className="cell-link" aria-label={label}>
        <span className="cell-title ellipsis">{title}</span>
        {p.attention && (
          <span className="cell-bubble" key={p.attention.attentionId}>
            {ATTENTION_LABEL[p.attention.kind] ?? p.attention.kind}
          </span>
        )}
        <svg className="cell-art" viewBox={`0 0 ${CELL_W} ${CELL_H}`} width={CELL_W} height={CELL_H} aria-hidden="true">
          <use href="#o-chair" />
          <use href="#o-desk" />
          <use href="#o-monitor" />
          <rect
            className={`cell-screen cell-screen--${p.screen}`}
            x="47.5"
            y="21.5"
            width="27"
            height="12.5"
            rx="0.5"
          />
          {p.tool && p.screen === "lit" && (
            <text key={p.tool} className="cell-tool" x="61" y="30.8" textAnchor="middle">
              {screenText(p.tool)}
            </text>
          )}
          <text className="cell-mono" x="61" y="41.8" textAnchor="middle">
            {mark.glyph}
          </text>
          {front && (
            <text className="cell-front" x="40" y="52.8">
              {front}
            </text>
          )}
          <use href="#o-lamp" />
          <use href="#o-lamp-on" className={`cell-lamp ${p.state === "needs_you" ? "cell-lamp--on" : ""}`} />
          {Array.from({ length: p.errors }, (_, i) => (
            <use
              key={i === p.errors - 1 ? `top-${s.counts.toolErrors}` : i}
              href="#o-sheet"
              className={`cell-sheet ${i === p.errors - 1 ? "cell-sheet--top" : ""}`}
              x={77 + i}
              y={42.5 - i}
            />
          ))}
          {p.elapsedMs !== undefined && (
            <text className="cell-elapsed" x="59" y="63.5" textAnchor="middle">
              {durShort(p.elapsedMs)}
            </text>
          )}
          {p.phase === "seated" || p.phase === "leaving" ? (
            <g className="seated">
              <Figure p={p} />
            </g>
          ) : (
            <g className="seated">
              <Figure p={{ ...p, state: "idle", typing: false }} />
            </g>
          )}
          {p.phase !== "seated" && (
            <g className="walker">
              <use href="#o-stand" />
              <use href="#o-legs-a" className="legs-a" />
              <use href="#o-legs-b" className="legs-b" />
            </g>
          )}
        </svg>
        <span className="cell-tip" role="tooltip">
          <b>{title}</b>
          <span>
            {mark.label}
            {s.model ? ` · ${modelShort(s.model)}` : ""}
          </span>
          <span>
            {STATE_LABEL[p.state]} · {since(s.stateSince, now)}
          </span>
          {s.currentTool && (
            <span>
              <code>{s.currentTool.tool}</code> · {since(s.currentTool.since, now)}
            </span>
          )}
          {p.attention && (
            <span className="cell-tip-attn">
              {ATTENTION_LABEL[p.attention.kind] ?? p.attention.kind}
              {p.attention.message ? (
                <>
                  {" · "}
                  <Redacted text={p.attention.message} />
                </>
              ) : null}
            </span>
          )}
          {repoBranch(s) && <span className="mono">{repoBranch(s)}</span>}
          <span className="num">
            {[
              plural(s.counts.turns, "turn"),
              plural(s.counts.tools, "tool"),
              plural(s.counts.toolErrors, "error"),
              plural(s.counts.filesChanged, "file"),
              plural(s.children, "subagent"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </Link>
      {p.helpers.map((c, i) => (
        <Helper key={c.key} c={c} i={i} now={now} cursor={helperCursor?.(i)} />
      ))}
      {p.hiddenHelpers > 0 && (
        <span
          className="cell-more num"
          style={{ "--i": p.helpers.length } as CSSProperties}
          title={`${p.hiddenHelpers} more subagents`}
        >
          +{p.hiddenHelpers}
        </span>
      )}
    </div>
  );
});

function Figure({ p }: { p: Posture }) {
  switch (p.state) {
    case "working":
      return (
        <g className="fig">
          <use href="#o-legs-side" />
          <use href="#o-torso-side" />
          <g className={`arm arm--type ${p.typing ? "arm--typing" : ""}`}>
            <use href="#o-arm-type" />
          </g>
        </g>
      );
    case "needs_you":
      return (
        <g className="fig">
          <use href="#o-legs-front" />
          <use href="#o-torso-front" />
          <use href="#o-arm-left-down" />
          <g className="arm arm--raise">
            <use href="#o-arm-raise" />
          </g>
        </g>
      );
    case "stale":
      return (
        <g className="fig">
          <use href="#o-legs-side" />
          <g transform="rotate(-18 18 56)">
            <g className="breath">
              <use href="#o-torso-side" />
              <use href="#o-arm-rest" />
            </g>
          </g>
        </g>
      );
    default:
      return (
        <g className="fig">
          <use href="#o-legs-front" />
          <g className="breath">
            <use href="#o-torso-front" />
            <use href="#o-arm-lap" />
          </g>
        </g>
      );
  }
}

/** A subagent standing by its parent's desk, with its own link and tooltip. */
export function Helper({ c, i, now, cursor }: { c: SessionSummary; i: number; now: number; cursor?: number }) {
  const title = sessionTitle(c);
  const tool = c.state === "working" ? c.currentTool?.tool : undefined;
  return (
    <Link
      to={sessionPath(c.harness, c.id)}
      className={`cell-helper cell-helper--${c.state}`}
      aria-label={[`subagent ${title}`, STATE_LABEL[c.state], tool ?? ""].filter(Boolean).join(", ")}
      data-cursor={cursor !== undefined ? String(cursor) : undefined}
      style={{ "--i": i } as CSSProperties}
    >
      <svg className="helper-art" viewBox="-2.5 -3 10 20" width="10" height="20" aria-hidden="true">
        <use href="#o-helper" />
        {c.state === "needs_you" && <use href="#o-helper-raise" />}
      </svg>
      <span className="cell-tip" role="tooltip">
        <b>{title}</b>
        <span>subagent · {harnessMark(c.harness).label}</span>
        <span>
          {STATE_LABEL[c.state]} · {since(c.stateSince, now)}
        </span>
        {c.currentTool && (
          <span>
            <code>{c.currentTool.tool}</code> · {since(c.currentTool.since, now)}
          </span>
        )}
      </span>
    </Link>
  );
}

/** An unoccupied desk: chair, desk, monitor off. */
export function EmptyDesk({ col, row }: { col: number; row: number }) {
  return (
    <div className="cell cell--empty" style={{ "--col": col, "--row": row } as CSSProperties} aria-hidden="true">
      <svg className="cell-art" viewBox={`0 0 ${CELL_W} ${CELL_H}`} width={CELL_W} height={CELL_H} aria-hidden="true">
        <use href="#o-chair" />
        <use href="#o-desk" />
        <use href="#o-monitor" />
        <rect className="cell-screen cell-screen--off" x="47.5" y="21.5" width="27" height="12.5" rx="0.5" />
        <use href="#o-lamp" />
      </svg>
    </div>
  );
}
