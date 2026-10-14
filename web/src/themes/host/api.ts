// SPDX-License-Identifier: Apache-2.0
// The ThemeApi a mounted theme is handed (shared/theme-api.ts), built from what the
// page already has: the store, the transport, the router, the format helpers, the
// design tokens and the host's React. One instance per mount; `dispose()` drops the
// store subscription when the theme unmounts.
import { type SessionKey, type SessionSummary, type Stats, splitKey } from "@shared/api";
import {
  type ConnectionState,
  type InstalledTheme,
  THEME_API_VERSION,
  THEME_ROUTES,
  type ThemeApi,
  type ThemeSnapshot,
} from "@shared/theme-api";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { createControlApi } from "../../control/themeControl";
import type { AppState, Store } from "../../data/store";
import { harnessMark, repoBranch, sessionTitle } from "../../lib/format";
import { navigate, sessionPath } from "../../lib/router";
import { openSplit } from "../../lib/split";
import { ago, dur } from "../../lib/time";
import tokensCss from "../../styles/tokens.css?raw";

/** Every custom property tokens.css defines, once, in order of first appearance. */
export const TOKENS: readonly string[] = (() => {
  const seen = new Set<string>();
  for (const m of tokensCss.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)) seen.add(m[1]!);
  return Object.freeze([...seen]);
})();

const EMPTY_STATS: Stats = { events: 0, sessions: 0, machines: 0, eventsLastMinute: 0, storageBytes: 0, uptimeS: 0 };

const CONNECTION: Record<AppState["connection"], ConnectionState> = {
  connecting: "connecting",
  reconnecting: "connecting",
  live: "live",
  offline: "offline",
};

/** The scheme the page renders in right now: the explicit choice, else the OS. */
export function resolvedScheme(): "dark" | "light" {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark" || t === "light") return t;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Fires when the resolved scheme changes (the theme switch, or the OS). */
function watchScheme(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener?.("change", onChange);
  return () => {
    mo.disconnect();
    mq?.removeEventListener?.("change", onChange);
  };
}

export function toSnapshot(s: AppState, scheme: "dark" | "light"): ThemeSnapshot {
  return Object.freeze({
    connection: CONNECTION[s.connection],
    sessions: s.sessions,
    machines: s.machines,
    stats: s.stats ?? EMPTY_STATS,
    control: s.control,
    recent: s.recent,
    scheme,
    viewers: s.viewers,
  });
}

export interface ThemeApiOptions {
  store: Store;
  manifest: InstalledTheme;
  host: { name: string; version: string };
}

export function createThemeApi(opts: ThemeApiOptions): { api: ThemeApi; dispose: () => void } {
  const { store, manifest } = opts;
  const id = manifest.id;
  const baseUrl = `${location.origin}${manifest.url}`;

  // One immutable snapshot per change of the store or the scheme, built on demand.
  let scheme = resolvedScheme();
  let cached: { base: AppState; scheme: "dark" | "light"; snap: ThemeSnapshot } | null = null;
  const get = (): ThemeSnapshot => {
    const base = store.get();
    if (!cached || cached.base !== base || cached.scheme !== scheme) {
      cached = { base, scheme, snap: toSnapshot(base, scheme) };
    }
    return cached.snap;
  };
  const subscribers = new Set<(s: ThemeSnapshot) => void>();
  const notify = () => {
    if (subscribers.size === 0) return;
    const snap = get();
    for (const l of subscribers) {
      try {
        l(snap);
      } catch (e) {
        console.error(`[theme ${id}] subscriber threw`, e);
      }
    }
  };
  const unsubStore = store.subscribe(notify);
  const unwatch = watchScheme(() => {
    const next = resolvedScheme();
    if (next === scheme) return;
    scheme = next;
    notify();
  });

  const statePath = `${THEME_ROUTES.state}/${encodeURIComponent(id)}/state`;
  const localKey = (k: string) => `sessionpipe-gui.theme.${id}.${k}`;

  const api: ThemeApi = {
    version: THEME_API_VERSION,
    host: opts.host,
    manifest,
    baseUrl,
    state: {
      get,
      subscribe(listener) {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
    },
    onEvent: (listener) => store.onEvent(listener),
    fetch: {
      session(key, o = {}) {
        const { harness, id: sid } = splitKey(key);
        return store.transport.session(harness, sid, o);
      },
      forget(key) {
        const { harness, id: sid } = splitKey(key);
        return store.transport.forget(harness, sid);
      },
    },
    navigate: (path) => navigate(path),
    openSession(key: SessionKey, opts) {
      if (opts?.split) {
        openSplit(key, opts.from);
        return;
      }
      const { harness, id: sid } = splitKey(key);
      navigate(sessionPath(harness, sid));
    },
    tokens: TOKENS,
    storage: {
      async get<T = unknown>(): Promise<T | null> {
        const res = await fetch(statePath, { headers: { accept: "application/json" } });
        if (res.status === 204) return null;
        if (!res.ok) throw new Error(`theme storage: ${res.status} ${res.statusText}`);
        return (await res.json()) as T;
      },
      async set(value: unknown): Promise<void> {
        const res = await fetch(statePath, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value === undefined ? null : value),
        });
        if (!res.ok) {
          throw new Error(res.status === 413 ? "theme storage: value is over 256 KB" : `theme storage: ${res.status}`);
        }
      },
    },
    local: {
      get<T = unknown>(key: string): T | null {
        try {
          const raw = localStorage.getItem(localKey(key));
          return raw === null ? null : (JSON.parse(raw) as T);
        } catch {
          return null;
        }
      },
      set(key: string, value: unknown): void {
        try {
          if (value === undefined || value === null) localStorage.removeItem(localKey(key));
          else localStorage.setItem(localKey(key), JSON.stringify(value));
        } catch {
          // private mode or full: per-device storage is a convenience only
        }
      },
    },
    control: createControlApi({ machines: () => store.get().machines, sessions: () => store.get().sessions }),
    react: { React, ReactDOM, createRoot },
    format: {
      ago: (iso, now = Date.now()) => ago(iso, now),
      duration: (ms) => dur(ms),
      title: (s: SessionSummary) => sessionTitle(s),
      repoBranch: (s: SessionSummary) => repoBranch(s),
      monogram: (harness) => harnessMark(harness).glyph,
    },
  };

  return {
    api,
    dispose: () => {
      unsubStore();
      unwatch();
      subscribers.clear();
    },
  };
}
