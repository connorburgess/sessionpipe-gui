// SPDX-License-Identifier: Apache-2.0
// The side panel: a session open beside the current page. Which session is in the URL
// (`?s=<harness>:<id>`, so reload and back/forward keep it); the width is per device;
// the rectangle an open animates out of is handed over once and consumed by the panel.
import type { SessionKey } from "@shared/api";
import { useSyncExternalStore } from "react";
import { SPLIT_PARAM, setSearchParam, useSearchParam } from "./router";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const SPLIT_MIN = 420;
/** Room the page keeps when the panel is dragged wide. */
export const PAGE_MIN = 360;
const KEY_WIDTH = "sessionpipe-gui.splitWidth";

let pendingFrom: Rect | null = null;
let width: number | null = (() => {
  try {
    const v = Number(localStorage.getItem(KEY_WIDTH));
    return v >= SPLIT_MIN ? v : null;
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** The panel's width for this viewport: the stored one, else 44 %, never under SPLIT_MIN
 *  and never squeezing the page under PAGE_MIN. */
export function splitWidth(viewport = window.innerWidth): number {
  const want = width ?? Math.round(viewport * 0.44);
  return Math.max(SPLIT_MIN, Math.min(want, viewport - PAGE_MIN));
}

export function setSplitWidth(px: number): void {
  width = Math.round(px);
  try {
    localStorage.setItem(KEY_WIDTH, String(width));
  } catch {
    // per-page only
  }
  emit();
}

/** The panel width, live: follows drags and the viewport (the caller re-renders on resize). */
export function useSplitWidth(): number {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => width,
    () => width,
  );
  return splitWidth();
}

export function openSplit(key: SessionKey, from?: Rect): void {
  pendingFrom = from ?? null;
  setSearchParam(SPLIT_PARAM, key);
}

export function closeSplit(): void {
  setSearchParam(SPLIT_PARAM, null);
}

/** The rectangle the last `openSplit` asked to animate from, once. */
export function takeFrom(): Rect | null {
  const r = pendingFrom;
  pendingFrom = null;
  return r;
}

/** The session key in the panel, or null. */
export function useSplitKey(): SessionKey | null {
  const v = useSearchParam(SPLIT_PARAM);
  return v?.includes(":") ? v : null;
}
