// SPDX-License-Identifier: Apache-2.0
// A room is a machine: nameplate outside the top wall, a window band tinted by the hour,
// desks on a grid whose slot 0 is by the door, the door as a gap in the bottom wall and
// the "gone home" tally beside it (DESIGN.md §1).
import type { MachineSummary, SessionSummary } from "@shared/api";
import type { CSSProperties } from "react";
import { harnessMark } from "../../lib/format";
import { Link } from "../../lib/router";
import type { HourBand, Posture } from "../posture";
import { Cell, EmptyDesk } from "./Worker";

export interface RoomCell {
  s: SessionSummary;
  p: Posture;
  slot: number;
  walk: boolean;
  /** Keyboard order: this desk's index, and the first index of its helpers. */
  index?: number;
  helperBase?: number;
}

export function Room({
  name,
  machine,
  cells,
  cols,
  rows,
  gone,
  band,
  now,
  cursor = -1,
}: {
  name: string;
  machine?: MachineSummary;
  cells: RoomCell[];
  cols: number;
  rows: number;
  gone: number;
  band: HourBand;
  now: number;
  /** The j/k cursor over the page's href list. */
  cursor?: number;
}) {
  const capacity = cols * rows;
  const shown = cells.filter((c) => c.slot < capacity);
  const hidden = cells.length - shown.length;
  const taken = new Set(shown.map((c) => c.slot));
  const empties: number[] = [];
  for (let i = 0; i < Math.min(2, capacity) && shown.length + empties.length < 2; i++)
    if (!taken.has(i)) empties.push(i);

  const pairs = machine
    ? Object.entries(machine.harnesses)
    : [...new Map(cells.map((c) => [c.s.harness, c.s.harnessVersion])).entries()];
  const online = machine?.control?.online === true;

  return (
    <section
      className="room"
      style={{ "--cols": cols, "--rows": rows } as CSSProperties}
      aria-label={`${name}: ${cells.length} at desks`}
    >
      <Link to="/machines" className="room-plate">
        <span className="room-name">{name}</span>
        {pairs.map(([h, v]) => (
          <span key={h} className="room-pair">
            <b>{harnessMark(h).glyph}</b> {v ?? ""}
          </span>
        ))}
        <span
          className={`room-dot ${online ? "room-dot--on" : ""}`}
          role="img"
          aria-label={machine?.control ? (online ? "control online" : "control offline") : "no control daemon"}
        />
        {hidden > 0 && <span className="room-more">+{hidden} more</span>}
      </Link>
      <div className={`room-box window--${band}`}>
        <div className="room-window" />
        <div className="room-floor">
          {shown.map((c) => (
            <Cell
              key={c.s.key}
              s={c.s}
              p={c.p}
              slot={c.slot}
              col={c.slot % cols}
              row={Math.floor(c.slot / cols)}
              now={now}
              walk={c.walk}
              cursor={c.index === cursor ? cursor : undefined}
              helperCursor={(i) => (c.helperBase !== undefined && c.helperBase + i === cursor ? cursor : undefined)}
            />
          ))}
          {empties.map((i) => (
            <EmptyDesk key={`empty-${i}`} col={i % cols} row={Math.floor(i / cols)} />
          ))}
        </div>
        <span className="room-door" aria-hidden="true" />
        {gone > 0 && (
          <span className="room-home num" title={`${gone} session${gone === 1 ? "" : "s"} done today`}>
            {gone} home
          </span>
        )}
      </div>
    </section>
  );
}
