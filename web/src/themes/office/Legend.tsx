// SPDX-License-Identifier: Apache-2.0
// The legend behind `?`: the four postures at 24 px, then the lamp, bubble, helper,
// sheets, monogram and elapsed numeral, one line each. The page must read without it.
import type { SessionState } from "@shared/api";
import { STATE_HINT, STATE_LABEL } from "../../lib/format";

const POSTURES: SessionState[] = ["working", "needs_you", "stale", "idle"];

function Mini({ state }: { state: SessionState }) {
  const screen = state === "working" ? "lit" : state === "needs_you" ? "dim" : state === "stale" ? "pale" : "off";
  return (
    <svg className={`legend-art legend-art--${state}`} viewBox="4 20 76 56" width="33" height="24" aria-hidden="true">
      <use href="#o-chair" />
      <use href="#o-desk" />
      <use href="#o-monitor" />
      <rect className={`cell-screen cell-screen--${screen}`} x="47.5" y="21.5" width="27" height="12.5" />
      <use href="#o-lamp" />
      {state === "needs_you" && <use href="#o-lamp-on" />}
      {state === "working" && (
        <g>
          <use href="#o-legs-side" />
          <use href="#o-torso-side" />
          <use href="#o-arm-type" />
        </g>
      )}
      {state === "needs_you" && (
        <g>
          <use href="#o-legs-front" />
          <use href="#o-torso-front" />
          <use href="#o-arm-left-down" />
          <use href="#o-arm-raise" />
        </g>
      )}
      {state === "stale" && (
        <g>
          <use href="#o-legs-side" />
          <g transform="rotate(-18 18 56)">
            <use href="#o-torso-side" />
            <use href="#o-arm-rest" />
          </g>
        </g>
      )}
      {state === "idle" && (
        <g>
          <use href="#o-legs-front" />
          <use href="#o-torso-front" />
          <use href="#o-arm-lap" />
        </g>
      )}
    </svg>
  );
}

export function Legend({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <>
      <button
        type="button"
        className="legend-btn"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="office-legend"
        title="Legend (?)"
      >
        ?
      </button>
      {open && (
        <div className="legend" id="office-legend" role="dialog" aria-label="Legend">
          <div className="legend-head">
            <span>How to read the office</span>
            <button type="button" className="legend-close" onClick={onToggle} data-dismiss aria-label="Close legend">
              ×
            </button>
          </div>
          <ul className="legend-list">
            {POSTURES.map((st) => (
              <li key={st}>
                <Mini state={st} />
                <span>
                  <b>{STATE_LABEL[st]}</b> {STATE_HINT[st]}
                </span>
              </li>
            ))}
            <li>
              <svg
                className="legend-art legend-art--needs_you"
                viewBox="70 10 20 12"
                width="24"
                height="14"
                aria-hidden="true"
              >
                <use href="#o-lamp" />
                <use href="#o-lamp-on" />
              </svg>
              <span>
                <b>lamp</b> amber only while someone needs you; the bubble names what for.
              </span>
            </li>
            <li>
              <span className="legend-bubble">permission</span>
              <span>
                <b>bubble</b> the kind of attention; the full message is in the tooltip.
              </span>
            </li>
            <li>
              <svg className="legend-art" viewBox="-2.5 -3 10 20" width="10" height="20" aria-hidden="true">
                <use href="#o-helper" />
              </svg>
              <span>
                <b>helper</b> a subagent standing by its parent's desk; up to three, then +n.
              </span>
            </li>
            <li>
              <svg className="legend-art" viewBox="74 38 14 10" width="20" height="14" aria-hidden="true">
                <use href="#o-sheet" x="77" y="42.5" />
                <use href="#o-sheet" x="78" y="41.5" />
              </svg>
              <span>
                <b>sheets</b> tool errors on the desk corner: one for 1–2, two for 3–5, three for more.
              </span>
            </li>
            <li>
              <span className="legend-mono">Cl</span>
              <span>
                <b>monogram</b> the harness, on the monitor's bezel.
              </span>
            </li>
            <li>
              <span className="legend-num num">2m10s</span>
              <span>
                <b>elapsed</b> under the desk once a tool has run for more than a minute.
              </span>
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
