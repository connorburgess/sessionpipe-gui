// SPDX-License-Identifier: Apache-2.0
// Per-device display settings, persisted in localStorage: the appearance (follow the OS,
// dark, light), a color theme (a token set; forces its scheme while applied) and the
// text size (a scale on the root font-size, so every rem-based size follows).
import { useSyncExternalStore } from "react";
import { applyColorTheme, type ColorTheme } from "./colorTheme";

export type Theme = "auto" | "light" | "dark";
export type TextSize = 0.9 | 1 | 1.1 | 1.25;
export const TEXT_SIZES: readonly TextSize[] = [0.9, 1, 1.1, 1.25];

export interface Settings {
  appearance: Theme;
  /** The applied color theme itself (not just its id), so it applies at boot before any fetch. */
  colorTheme: ColorTheme | null;
  textSize: TextSize;
}

const KEY = "sessionpipe-gui.theme";
const KEY_COLOR = "sessionpipe-gui.colorTheme";
const KEY_TEXT = "sessionpipe-gui.textSize";
const listeners = new Set<() => void>();

const read = (): Settings => {
  let appearance: Theme = "auto";
  let colorTheme: ColorTheme | null = null;
  let textSize: TextSize = 1;
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") appearance = v;
    const c = localStorage.getItem(KEY_COLOR);
    if (c) {
      const parsed = JSON.parse(c) as ColorTheme;
      if (parsed && typeof parsed.id === "string" && parsed.tokens) colorTheme = parsed;
    }
    const t = Number(localStorage.getItem(KEY_TEXT));
    if ((TEXT_SIZES as readonly number[]).includes(t)) textSize = t as TextSize;
  } catch {
    // private mode or blocked storage: defaults
  }
  return { appearance, colorTheme, textSize };
};
let settings: Settings = read();

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // the choice lasts for this page only
  }
};

/** Puts every setting on the document. Called at boot and after each change. */
export function applySettings(s: Settings = settings): void {
  const root = document.documentElement;
  const scheme = s.colorTheme?.scheme ?? s.appearance;
  if (scheme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", scheme);
  applyColorTheme(s.colorTheme);
  root.style.fontSize = s.textSize === 1 ? "" : `${s.textSize * 100}%`;
}

/** Kept for callers of the first version; applies everything. */
export const applyTheme = (t?: Theme): void => applySettings(t ? { ...settings, appearance: t } : settings);

function commit(next: Settings) {
  settings = next;
  applySettings(next);
  for (const l of listeners) l();
}

export function setTheme(t: Theme): void {
  write(KEY, t === "auto" ? null : t);
  commit({ ...settings, appearance: t });
}

export function setColorTheme(theme: ColorTheme | null): void {
  write(KEY_COLOR, theme ? JSON.stringify(theme) : null);
  commit({ ...settings, colorTheme: theme });
}

export function setTextSize(size: TextSize): void {
  write(KEY_TEXT, size === 1 ? null : String(size));
  commit({ ...settings, textSize: size });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useSettings(): Settings {
  return useSyncExternalStore(
    subscribe,
    () => settings,
    () => settings,
  );
}

export function useTheme(): Theme {
  return useSettings().appearance;
}
