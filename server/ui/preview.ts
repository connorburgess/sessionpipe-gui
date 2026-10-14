// SPDX-License-Identifier: Apache-2.0
// A shorter preview for list pages: the index keeps 2 KB of each big string (slim.ts);
// a page the Session view opens on asks for less (`preview=<chars>`), so a hundred
// events fit in one small response. `preview` keeps the original lengths either way.
import type { StoredEvent } from "../../shared/api.js";

const BIG_KEYS = ["input", "output", "user", "assistant"] as const;
export const PREVIEW_MIN = 200;
export const PREVIEW_MAX = 2048;

export function cutPreview(ev: StoredEvent, chars: number): StoredEvent {
  const n = Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, chars));
  const had = ev.preview ?? {};
  let data: Record<string, unknown> | null = null;
  let preview: Record<string, number> | null = null;
  for (const k of BIG_KEYS) {
    const v = ev.data[k];
    if (v === undefined || v === null) continue;
    const text = typeof v === "string" ? v : JSON.stringify(v);
    if (text.length <= n) continue;
    data ??= { ...ev.data };
    preview ??= { ...had };
    data[k] = text.slice(0, n);
    preview[k] = had[k] ?? text.length;
  }
  return data ? { ...ev, data, preview: { ...had, ...preview } } : ev;
}
