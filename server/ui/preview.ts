// SPDX-License-Identifier: Apache-2.0
// A shorter preview for list pages: the index keeps 2 KB of each big string (slim.ts);
// a page the Session view opens on asks for less (`preview=<chars>`), so a hundred
// events fit in one small response. `preview` keeps the original lengths either way.
import type { StoredEvent } from "../../shared/api.js";
import { trimPreview } from "../store/slim.js";

export const PREVIEW_MIN = 200;
export const PREVIEW_MAX = 2048;

export function cutPreview(ev: StoredEvent, chars: number): StoredEvent {
  return trimPreview(ev, Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, chars)));
}
