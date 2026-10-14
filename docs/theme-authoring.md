# Writing a theme

A theme is a plugin that draws the board its own way: a different page in the GUI,
listed on the rail, rendering into a container the host gives it. It is an ES module
plus a `theme.json`, kept **outside** the GUI under the state dir
(`~/.local/state/sessionpipe-gui/themes/<id>/`), served by the GUI at `/themes/<id>/`
and imported by the page at runtime. The host talks to it through one object, the
`ThemeApi`, and expects one thing back: a function that unmounts it.

The contract is `shared/theme-api.ts`; this page explains it.

## A theme in thirty lines

`theme.json`:

```json
{ "id": "tally", "name": "Tally", "version": "0.1.0", "api": 1 }
```

`index.js`:

```js
export default {
  mount(container, api) {
    const el = document.createElement("div");
    el.style.cssText = "padding:24px;font:14px/1.5 var(--font-ui);color:var(--fg)";
    container.append(el);

    const draw = (snap) => {
      const needs = [...snap.sessions.values()].filter((s) => s.state === "needs_you");
      el.innerHTML = `
        <h1>${snap.sessions.size} sessions · ${needs.length} need you</h1>
        <p>${snap.stats.eventsLastMinute} events in the last minute · ${snap.connection}</p>
        <ul>${[...snap.sessions.values()]
          .map((s) => `<li data-key="${s.key}">${api.format.monogram(s.harness)} ${api.format.title(s)} · ${s.state}</li>`)
          .join("")}</ul>`;
    };
    draw(api.state.get());
    const stop = api.state.subscribe(draw);

    el.addEventListener("click", (e) => {
      const key = e.target.closest("[data-key]")?.dataset.key;
      if (key) api.openSession(key);
    });
    return () => stop(); // unmount: stop listening; the host clears the container
  },
};
```

Install it and open `/t/tally`:

```sh
sessionpipe-gui theme add ./tally       # copies the folder
sessionpipe-gui theme link ./tally      # or: symlink it while you work on it
```

## The manifest

`theme.json` sits beside the entry module.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `[a-z][a-z0-9-]{1,40}`. The folder name, the route (`/t/<id>`) and the storage key. |
| `name` | yes | Shown on the rail and the Themes page. |
| `version` | yes | Yours; shown on the Themes page. |
| `api` | yes | The `ThemeApi` version you wrote against (`1` today). The host refuses a theme whose `api` is newer than its own. |
| `entry` | no | The ES module, relative to the folder; `index.js` by default. |
| `style` | no | A stylesheet the host links before mounting and removes after. Scope your selectors: it lands in the whole page. |
| `icon` | no | Inline SVG for the rail (24×24 viewBox, `currentColor`). Without one you get a plug. |
| `description` | no | One line for the Themes page. |
| `experimental` | no | `true` puts the entry under the "experimental" divider. |
| `source` | — | Written by the host on install; leave it out. |

## The `ThemeApi`

`mount(container, api)` is called once the module has loaded, with a container that
fills the page below the shell: no padding, `position: relative; overflow: hidden`.
Scrolling inside it is yours to do. Return the function that unmounts (it may be
`async`). The host calls it when the route changes, then clears the container.

| Member | What it is |
|---|---|
| `version` | `1`. |
| `host` | `{ name: "sessionpipe-gui", version }`. |
| `manifest` | Your `theme.json` as installed (with `source`, `url`, `linked`). |
| `baseUrl` | Absolute URL prefix of your own files: `new URL("worker.js", api.baseUrl)`. |
| `state.get()` | The current `ThemeSnapshot` (below). Immutable; a new object per change. |
| `state.subscribe(fn)` | `fn(snapshot)` on every change; returns the unsubscribe. |
| `onEvent(fn)` | `fn(event, session)` for each live event as it arrives, with the session summary after applying it. Returns the unsubscribe. |
| `fetch.session(key, { after, limit })` | The full events of one session (`SessionDetail`), read from disk. |
| `fetch.forget(key)` | Delete a session, as the board's Forget does. |
| `navigate(path)` | Go to any page of the GUI (`"/feed"`, `"/t/other"`). |
| `openSession(key)` | Go to that session's page. |
| `tokens` | The CSS custom properties the host defines on `:root` (`--bg`, `--fg`, `--fg-2`, `--line`, `--needs`, `--err`, …), right for both colour schemes. Use them and your theme follows the switch. |
| `storage.get()` / `storage.set(value)` | One JSON document per theme, kept by the server and shared by every device, at most 256 KB. `get()` is `null` until the first `set`. |
| `local.get(key)` / `local.set(key, value)` | `localStorage`, namespaced to your theme, for per-device conveniences. May silently be unavailable. |
| `react` | `{ React, ReactDOM, createRoot }`: the host's React 18, for a theme that wants it without bundling its own. |
| `format.ago(iso)` | `"12 s ago"`, `"3 m ago"`, `"yesterday"`. |
| `format.duration(ms)` | `"0.4 s"`, `"4 m 12 s"`, `"2 h 05 m"`. |
| `format.title(session)` | The title, else the cwd's basename, else the id's head. |
| `format.repoBranch(session)` | `"org/repo @ main"`. |
| `format.monogram(harness)` | `"Cl"` for claude-code, `"Cx"` for codex, … |

A `ThemeSnapshot`:

```ts
{
  connection: "connecting" | "live" | "offline",
  sessions: ReadonlyMap<SessionKey, SessionSummary>,   // key = "<harness>:<id>"
  machines: ReadonlyMap<string, MachineSummary>,
  stats: Stats,                                         // events, sessions, eventsLastMinute, …
  control: readonly ControlActivity[],                  // newest first
  recent: readonly StoredEvent[],                       // newest first, the live tail (≤ 1500)
  scheme: "dark" | "light",                             // what the page renders in right now
}
```

`SessionSummary`, `StoredEvent` and the rest are in `shared/api.ts`. A session's
`state` is the host's reading (`needs_you`, `working`, `stale`, `idle`, `done`);
`openAttentions`, `currentTool`, `currentTurn`, `counts` and `recentTools` are what
the board's cards are drawn from.

## The same theme with `api.react`

```jsx
// index.jsx, bundled to index.js (see below)
import React from "react";
import { createRoot } from "react-dom/client";

function Tally({ api }) {
  const snap = React.useSyncExternalStore(api.state.subscribe, api.state.get);
  const list = [...snap.sessions.values()];
  return (
    <div style={{ padding: 24, color: "var(--fg)" }}>
      <h1>{list.length} sessions</h1>
      <ul>
        {list.map((s) => (
          <li key={s.key}>
            <button type="button" onClick={() => api.openSession(s.key)}>
              {api.format.monogram(s.harness)} {api.format.title(s)} · {s.state}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default {
  mount(container, api) {
    const root = createRoot(container);
    root.render(<Tally api={api} />);
    return () => root.unmount();
  },
};
```

`react` and `react-dom/client` are not on the page under those names: bundle them,
or map them to `api.react` with a shim.

## Bundling with esbuild

Everything in, simplest (your theme carries its own React, ~45 KB gzipped):

```sh
npx esbuild index.jsx --bundle --format=esm --outfile=dist/index.js --jsx=automatic
```

Or lean on the host's React. Two tiny shims, marked external, filled in at mount:

```js
// shims/react.js
export default globalThis.__themeReact.React;
export const { useState, useEffect, useMemo, useRef, useSyncExternalStore, createElement, Fragment } =
  globalThis.__themeReact.React;
// shims/react-dom-client.js
export const createRoot = (...a) => globalThis.__themeReact.createRoot(...a);
```

```js
// build.mjs
import { build } from "esbuild";
await build({
  entryPoints: ["index.jsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/index.js",
  jsx: "automatic",
  alias: { react: "./shims/react.js", "react-dom/client": "./shims/react-dom-client.js" },
});
```

and first thing in `mount`: `globalThis.__themeReact = api.react;`. (With
`jsx: "automatic"` esbuild also imports `react/jsx-runtime`; alias that to a shim
exporting `jsx`, `jsxs` and `Fragment` from `api.react.React`, or use
`jsx: "transform"` with `jsxFactory: "React.createElement"` and the default import.)
Point `theme.json`'s `entry` at `dist/index.js`, or keep `index.js` as the output
name.

## Install, link, list, remove

```sh
sessionpipe-gui theme add ./my-theme               # a folder: copied
sessionpipe-gui theme add my-theme-0.1.0.tgz       # an archive: extracted (tar / unzip)
sessionpipe-gui theme add https://…/my-theme.zip   # downloaded, then extracted
sessionpipe-gui theme add sessionpipe-theme-tally  # an npm package name (npm install, then copied)
sessionpipe-gui theme add https://github.com/you/tally.git
sessionpipe-gui theme link ./my-theme              # a symlink: edits show on the next visit
sessionpipe-gui theme list
sessionpipe-gui theme remove tally
```

The id always comes from the theme's own `theme.json`; the installed copy records
where it came from in `source`. `--state DIR` (or `--themes-dir DIR`) chooses the
folder; the server reads it at boot and on **Reload** on the Themes page
(`POST /api/ui/themes/reload`, from the receiver machine only).

A **linked** theme is imported afresh on every visit to its page (a cache-busting
query string, and the server sends `no-cache` for `.js`, `.css` and `.json`), so an
edit shows after navigating away and back; no restart.

## Rules of the house

- The container is yours; nothing else on the page is. Scope your CSS.
- Return your unmount, and really stop everything in it: subscriptions, timers,
  workers, `requestAnimationFrame` loops. The host calls it when the person leaves.
- Snapshots are immutable: compare by identity, never mutate.
- Serve nothing from outside your folder; the host refuses anyway.
- A theme is code running in the board page with everything the page has. Tell people
  what yours does; they are told, when they install it, to install only what they
  trust.
