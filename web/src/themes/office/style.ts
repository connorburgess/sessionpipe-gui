// SPDX-License-Identifier: Apache-2.0
// The office's drawing style: figures (people at desks) or plan (a floor plan). Persisted
// per browser, the lib/theme.ts pattern. Both styles read the same Posture.
import { useSyncExternalStore } from "react";

export type OfficeStyle = "figures" | "plan";
const KEY = "sessionpipe-gui.office.style";
const listeners = new Set<() => void>();

const read = (): OfficeStyle => {
  try {
    return localStorage.getItem(KEY) === "figures" ? "figures" : "plan";
  } catch {
    return "plan";
  }
};
let style: OfficeStyle = read();

export function setOfficeStyle(s: OfficeStyle) {
  style = s;
  try {
    localStorage.setItem(KEY, s);
  } catch {
    // private mode: the choice lasts for this page only
  }
  for (const l of listeners) l();
}

export function useOfficeStyle(): OfficeStyle {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => style,
    () => style,
  );
}
