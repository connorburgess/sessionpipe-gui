// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. A carried message's lifecycle, as the receiver reads it
// (CONTROL.md §10): queued → taken → progress (the reply growing) → delivered, or
// expired / unsupported / failed / refused, each in words.
import type { ControlActivity } from "@shared/api";
import { Ago } from "../components/bits";
import { Markdown } from "../components/Markdown";
import { oneLine } from "../lib/format";
import { AttachmentThumbs, promptParts } from "./Attachments";
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
  // A prompt's attachments block (shared/attachments.ts) is drawn as thumbnails, not read as text.
  const prompt = a.text ? promptParts(a.text) : null;
  return (
    <li className={`ctl-act ctl-act--${state}`} data-outcome={state} data-message={a.id}>
      <div className="ctl-act-head">
        <span className="ctl-act-kind">{KIND_LABEL[a.kind]}</span>
        {prompt && (prompt.body || prompt.items.length === 0) && (
          <span className="ctl-act-text" title={prompt.body}>
            {oneLine(prompt.body, 120)}
          </span>
        )}
        <Ago iso={a.ackedAt ?? a.takenAt ?? a.at} />
      </div>
      {prompt && prompt.items.length > 0 && <AttachmentThumbs items={prompt.items} small />}
      <p className={`ctl-act-state ${live ? "is-live" : ""}`} aria-live="polite">
        {live && <span className="ctl-act-pulse" aria-hidden="true" />}
        {outcomeWords(a, { machine, online })}
      </p>
      {a.reply ? (
        <blockquote className={`ctl-act-reply ${wide ? "" : "ctl-act-reply--tail"} ${live ? "is-live" : ""}`}>
          <Markdown text={a.reply} />
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
