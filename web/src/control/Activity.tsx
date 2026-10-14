// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. A carried message's lifecycle, as the receiver reads it
// (CONTROL.md §10): queued → taken → progress (the reply growing) → delivered, or
// expired / unsupported / failed / refused, each in words.
import type { ControlActivity } from "@shared/api";
import { Ago } from "../components/bits";
import { oneLine } from "../lib/format";
import { isFinal, KIND_LABEL, outcomeWords, shownState } from "./words";

export function ActivityRow({
  a,
  machine,
  online,
  wide = false,
}: {
  a: ControlActivity;
  machine?: string;
  online?: boolean;
  /** Show the whole reply instead of the last lines. */
  wide?: boolean;
}) {
  const state = shownState(a);
  const live = !isFinal(a);
  return (
    <li className={`ctl-act ctl-act--${state}`} data-outcome={state} data-message={a.id}>
      <div className="ctl-act-head">
        <span className="ctl-act-kind">{KIND_LABEL[a.kind]}</span>
        {a.text && (
          <span className="ctl-act-text" title={a.text}>
            {oneLine(a.text, 120)}
          </span>
        )}
        <Ago iso={a.ackedAt ?? a.takenAt ?? a.at} />
      </div>
      <p className={`ctl-act-state ${live ? "is-live" : ""}`} aria-live="polite">
        {live && <span className="ctl-act-pulse" aria-hidden="true" />}
        {outcomeWords(a, { machine, online })}
      </p>
      {a.reply ? (
        <blockquote className={`ctl-act-reply ${wide ? "" : "ctl-act-reply--tail"} ${live ? "is-live" : ""}`}>
          {a.reply}
          {state === "progress" && <span className="caret" aria-hidden="true" />}
        </blockquote>
      ) : null}
    </li>
  );
}

export function ActivityList({
  items,
  machine,
  online,
  limit = 3,
}: {
  items: ControlActivity[];
  machine?: string;
  online?: boolean;
  limit?: number;
}) {
  if (items.length === 0) return null;
  return (
    <ol className="ctl-acts" aria-label="Messages sent">
      {items.slice(0, limit).map((a) => (
        <ActivityRow key={a.id} a={a} machine={machine} online={online} />
      ))}
    </ol>
  );
}
