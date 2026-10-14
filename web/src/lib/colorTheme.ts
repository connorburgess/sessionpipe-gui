// SPDX-License-Identifier: Apache-2.0
// Color themes: token sets applied on :root, like VS Code color themes. Five built-ins
// that stay inside the house style (one typeface, tinted neutrals, amber as the only
// accent), then whatever JSON the server found under <stateDir>/color-themes/.
import { ROUTES } from "@shared/api";
import { COLOR_TOKEN_NAMES, type ColorTheme, type ColorThemesResponse } from "@shared/color-theme";
import { useSyncExternalStore } from "react";

export type { ColorTheme } from "@shared/color-theme";

/** The id that means "no color theme: the scheme's own tokens". */
export const DEFAULT_COLOR_THEME = "default";

export const BUILTIN_COLOR_THEMES: readonly ColorTheme[] = [
  {
    id: "paper",
    name: "Paper",
    scheme: "light",
    tokens: {
      "--bg": "oklch(0.968 0.012 80)",
      "--bg-2": "oklch(0.994 0.006 80)",
      "--bg-3": "oklch(0.94 0.016 80)",
      "--bg-4": "oklch(0.905 0.02 80)",
      "--line": "oklch(0.885 0.018 80)",
      "--line-2": "oklch(0.82 0.022 78)",
      "--fg": "oklch(0.24 0.02 60)",
      "--fg-2": "oklch(0.45 0.02 60)",
      "--fg-3": "oklch(0.58 0.018 60)",
      "--fg-4": "oklch(0.7 0.014 60)",
      "--needs": "oklch(0.72 0.15 65)",
      "--needs-fg": "oklch(0.48 0.12 60)",
      "--needs-bg": "oklch(0.955 0.035 82)",
      "--needs-line": "oklch(0.85 0.08 75)",
      "--ok": "oklch(0.58 0.1 150)",
      "--err": "oklch(0.54 0.16 25)",
      "--err-soft": "oklch(0.6 0.09 25)",
      "--err-bg": "oklch(0.955 0.025 25)",
      "--focus": "oklch(0.5 0.03 60)",
      "--mark": "oklch(0.92 0.08 90)",
      "--mark-fg": "oklch(0.4 0.09 70)",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    scheme: "dark",
    tokens: {
      "--bg": "oklch(0.2 0.006 240)",
      "--bg-2": "oklch(0.23 0.007 240)",
      "--bg-3": "oklch(0.26 0.008 240)",
      "--bg-4": "oklch(0.3 0.009 240)",
      "--line": "oklch(0.29 0.008 240)",
      "--line-2": "oklch(0.36 0.01 240)",
      "--fg": "oklch(0.9 0.004 240)",
      "--fg-2": "oklch(0.7 0.005 240)",
      "--fg-3": "oklch(0.55 0.006 240)",
      "--fg-4": "oklch(0.43 0.006 240)",
      "--needs": "oklch(0.78 0.13 70)",
      "--needs-fg": "oklch(0.84 0.11 75)",
      "--needs-bg": "oklch(0.255 0.03 65)",
      "--needs-line": "oklch(0.41 0.07 65)",
      "--ok": "oklch(0.7 0.1 150)",
      "--err": "oklch(0.7 0.14 25)",
      "--err-soft": "oklch(0.64 0.08 25)",
      "--err-bg": "oklch(0.27 0.03 25)",
      "--focus": "oklch(0.72 0.01 240)",
      "--mark": "oklch(0.38 0.07 85)",
      "--mark-fg": "oklch(0.92 0.08 90)",
    },
  },
  {
    id: "ink",
    name: "Ink",
    scheme: "dark",
    tokens: {
      "--bg": "oklch(0.11 0.01 260)",
      "--bg-2": "oklch(0.14 0.01 260)",
      "--bg-3": "oklch(0.18 0.011 260)",
      "--bg-4": "oklch(0.23 0.012 260)",
      "--line": "oklch(0.3 0.012 260)",
      "--line-2": "oklch(0.42 0.014 260)",
      "--fg": "oklch(0.985 0.004 85)",
      "--fg-2": "oklch(0.85 0.006 85)",
      "--fg-3": "oklch(0.7 0.008 85)",
      "--fg-4": "oklch(0.55 0.01 260)",
      "--needs": "oklch(0.84 0.15 72)",
      "--needs-fg": "oklch(0.9 0.12 78)",
      "--needs-bg": "oklch(0.24 0.045 65)",
      "--needs-line": "oklch(0.5 0.1 65)",
      "--ok": "oklch(0.78 0.12 150)",
      "--err": "oklch(0.76 0.16 25)",
      "--err-soft": "oklch(0.7 0.1 25)",
      "--err-bg": "oklch(0.26 0.04 25)",
      "--focus": "oklch(0.85 0.02 85)",
      "--mark": "oklch(0.45 0.1 85)",
      "--mark-fg": "oklch(0.97 0.08 90)",
    },
  },
  {
    id: "sepia",
    name: "Sepia",
    scheme: "dark",
    tokens: {
      "--bg": "oklch(0.22 0.015 60)",
      "--bg-2": "oklch(0.25 0.016 60)",
      "--bg-3": "oklch(0.28 0.017 60)",
      "--bg-4": "oklch(0.32 0.018 60)",
      "--line": "oklch(0.3 0.016 60)",
      "--line-2": "oklch(0.37 0.018 60)",
      "--fg": "oklch(0.84 0.02 75)",
      "--fg-2": "oklch(0.68 0.02 70)",
      "--fg-3": "oklch(0.55 0.018 70)",
      "--fg-4": "oklch(0.44 0.015 65)",
      "--needs": "oklch(0.76 0.12 70)",
      "--needs-fg": "oklch(0.82 0.1 75)",
      "--needs-bg": "oklch(0.27 0.035 65)",
      "--needs-line": "oklch(0.4 0.06 65)",
      "--ok": "oklch(0.68 0.08 150)",
      "--err": "oklch(0.66 0.11 25)",
      "--err-soft": "oklch(0.6 0.07 25)",
      "--err-bg": "oklch(0.27 0.03 30)",
      "--focus": "oklch(0.7 0.02 75)",
      "--mark": "oklch(0.38 0.06 85)",
      "--mark-fg": "oklch(0.9 0.07 90)",
    },
  },
];

/** Sets the theme's tokens on :root (clearing the rest), or clears them all for null. */
export function applyColorTheme(theme: ColorTheme | null): void {
  const style = document.documentElement.style;
  for (const name of COLOR_TOKEN_NAMES) style.removeProperty(name);
  if (!theme) {
    document.documentElement.removeAttribute("data-color-theme");
    return;
  }
  for (const [k, v] of Object.entries(theme.tokens)) if (v) style.setProperty(k, v);
  document.documentElement.setAttribute("data-color-theme", theme.id);
}

// ----- the custom ones the server serves -----

interface Custom {
  themes: ColorTheme[];
  errors: { file: string; error: string }[];
  loaded: boolean;
}
let custom: Custom = { themes: [], errors: [], loaded: false };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

export function fetchColorThemes(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch(ROUTES.ui.colorThemes, { headers: { accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as ColorThemesResponse;
      custom = { themes: body.themes ?? [], errors: body.errors ?? [], loaded: true };
    })
    .catch(() => {
      // No server (mock mode) or an old one: only the built-ins.
      custom = { ...custom, loaded: true };
    })
    .finally(() => {
      inflight = null;
      for (const l of listeners) l();
    });
  return inflight;
}

export function useColorThemes(): Custom {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => custom,
    () => custom,
  );
}
