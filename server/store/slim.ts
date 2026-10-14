// SPDX-License-Identifier: Apache-2.0
// The in-memory copy of an event is slim: the big strings of `data` are cut to a
// preview so 100k events fit, and the original length is kept beside them. The full
// event stays on disk and is read back by byte offset (files.ts).
import type { StoredEvent } from "../../shared/api.js";

/** Characters kept in memory of each big `data` string. */
export const PREVIEW_CHARS = 2048;

/** A flat copy of a string. V8 keeps a `slice` as a view on its parent, so a 2 KB
 *  preview would pin the 64 KB it was cut from; copying through a Buffer does not. */
export const detach = (s: string): string => Buffer.from(s, "utf8").toString("utf8");

/** `data` keys that can be large: tool input/output (≤ 64 KB each) and turn text (≤ 20 000). */
const BIG_KEYS = ["input", "output", "user", "assistant"] as const;

/** A stored event as the index keeps it. `preview` lists the `data` keys that were cut
 *  and their original length in characters; absent when nothing was. */
export interface SlimEvent extends StoredEvent {
  preview?: Record<string, number>;
}

export function slimEvent(ev: StoredEvent): SlimEvent {
  let data: Record<string, unknown> | null = null;
  let preview: Record<string, number> | null = null;
  for (const k of BIG_KEYS) {
    const v = ev.data[k];
    if (v === undefined || v === null) continue;
    const text = typeof v === "string" ? v : JSON.stringify(v);
    if (text.length <= PREVIEW_CHARS) continue;
    data ??= { ...ev.data };
    preview ??= {};
    // A running assistant text keeps its end (spec §4 turn.progress); the rest its start.
    data[k] = detach(
      ev.type === "turn.progress" && k === "assistant" ? text.slice(-PREVIEW_CHARS) : text.slice(0, PREVIEW_CHARS),
    );
    preview[k] = text.length;
  }
  if (!data) return ev;
  return { ...ev, data, preview: preview! };
}
