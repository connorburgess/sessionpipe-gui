// SPDX-License-Identifier: Apache-2.0
// Colour scheme: follows the OS unless the person picked one. Persisted per browser.
import { useSyncExternalStore } from "react";

export type Theme = "auto" | "light" | "dark";
const KEY = "sessionpipe-gui.theme";
const listeners = new Set<() => void>();

const read = (): Theme => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
};
let theme: Theme = read();

export function applyTheme(t: Theme = theme) {
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

export function setTheme(t: Theme) {
  theme = t;
  try {
    if (t === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // private mode: the choice lasts for this page only
  }
  applyTheme(t);
  for (const l of listeners) l();
}

export function cycleTheme() {
  const order: Theme[] = ["auto", "dark", "light"];
  setTheme(order[(order.indexOf(theme) + 1) % order.length]!);
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => theme,
    () => theme,
  );
}
