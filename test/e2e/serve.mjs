// SPDX-License-Identifier: Apache-2.0
// The e2e web server: installs two fixture themes and two fixture skins into the e2e
// state dir with the real CLI (`theme add`, `skin add`) and then starts the server in this
// process, so they are there at boot. Playwright's webServer runs before globalSetup, which is why the install
// cannot live there. Arguments are passed through to the server unchanged.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = path.join(root, "dist", "cli.js");
const args = process.argv.slice(2);
const stateDir = args[args.indexOf("--state") + 1];
if (!stateDir || args.indexOf("--state") < 0) throw new Error("serve.mjs needs --state DIR");

/** A plain-DOM theme: session, event and viewer counts from the snapshot, live; a stored
 *  note through api.storage; a flag on window when unmounted. */
const COUNTER_JS = `export default {
  mount(el, api) {
    el.classList.add("e2e-counter");
    el.innerHTML = \`
      <h1 class="e2e-title">E2E Counter</h1>
      <p>sessions <b data-sessions>0</b> · events <b data-events>0</b> · scheme <b data-scheme></b> · host <b data-host></b></p>
      <p>stored <code data-stored>…</code></p>
      <p><input data-note placeholder="note"> <button type="button" data-save>save</button></p>
      <p>tokens <b data-tokens></b> · react <b data-react></b></p>
      <p><button type="button" data-open-split>open beside</button> <button type="button" data-open-split-bg>open beside, background</button></p>
      <p>viewers <b data-viewers>0</b> · me <code data-me></code> · <b data-current></b> · ids <code data-ids></code></p>
      <p data-legend hidden>legend: the view's own ? opened this</p>\`;
    // The view's own key, listened for the old way (no api.shortcuts): the host's ? help must stay shut here.
    const onKey = (e) => {
      if (e.key === "?" && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName ?? "")) {
        const legend = el.querySelector("[data-legend]");
        legend.hidden = !legend.hidden;
      }
    };
    document.addEventListener("keydown", onKey);
    const render = (s) => {
      el.querySelector("[data-sessions]").textContent = String(s.sessions.size);
      el.querySelector("[data-events]").textContent = String(s.recent.length);
      el.querySelector("[data-scheme]").textContent = s.scheme;
      const me = s.viewers.find((v) => v.current);
      el.querySelector("[data-viewers]").textContent = String(s.viewers.length);
      el.querySelector("[data-me]").textContent = me?.id ?? "";
      el.querySelector("[data-current]").textContent = me ? me.device + " · " + me.label : "";
      el.querySelector("[data-ids]").textContent = s.viewers.map((v) => v.id).join(",");
    };
    render(api.state.get());
    const unsubscribe = api.state.subscribe(render);
    el.querySelector("[data-host]").textContent = api.host.name + " " + api.host.version;
    el.querySelector("[data-tokens]").textContent = String(api.tokens.length);
    el.querySelector("[data-react]").textContent = typeof api.react?.createRoot;
    const stored = el.querySelector("[data-stored]");
    const show = async () => { stored.textContent = JSON.stringify(await api.storage.get()); };
    show();
    el.querySelector("[data-save]").addEventListener("click", async () => {
      await api.storage.set({ note: el.querySelector("[data-note]").value });
      await show();
    });
    el.querySelector("[data-open-split]").addEventListener("click", () => {
      const key = [...api.state.get().sessions.keys()][0];
      api.openSession(key, { split: true, from: { x: 10, y: 10, width: 200, height: 100 } });
    });
    el.querySelector("[data-open-split-bg]").addEventListener("click", () => {
      const key = [...api.state.get().sessions.keys()][1];
      api.openSession(key, { split: true, background: true });
    });
    window.__e2eThemeMounted = (window.__e2eThemeMounted ?? 0) + 1;
    return () => { unsubscribe(); document.removeEventListener("keydown", onKey); window.__e2eThemeUnmounted = (window.__e2eThemeUnmounted ?? 0) + 1; };
  },
};
`;

const fixtures = path.join(stateDir, "fixtures");
const counter = path.join(fixtures, "e2e-counter");
mkdirSync(counter, { recursive: true });
writeFileSync(
  path.join(counter, "theme.json"),
  JSON.stringify({
    id: "e2e-counter",
    name: "E2E Counter",
    version: "0.1.0",
    description: "Counts sessions and events, for the end-to-end suite.",
    api: 1,
    style: "style.css",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>',
  }),
);
writeFileSync(path.join(counter, "index.js"), COUNTER_JS);
writeFileSync(path.join(counter, "style.css"), ".e2e-counter { padding: 24px; } .e2e-title { color: rgb(1, 2, 3); }\n");

const broken = path.join(fixtures, "e2e-broken");
mkdirSync(broken, { recursive: true });
writeFileSync(
  path.join(broken, "theme.json"),
  JSON.stringify({ id: "e2e-broken", name: "E2E Broken", version: "0.0.1", api: 1, experimental: true }),
);
writeFileSync(path.join(broken, "index.js"), "export default { mount(el, api) { this is not javascript } };\n");

for (const dir of [counter, broken]) execFileSync(process.execPath, [cli, "theme", "add", dir, "--state", stateDir]);

/** A skin for both schemes with a bundled (stub) font, a stylesheet and every shape field,
 *  so the spec can see each of them land on <html>; and one with an unknown token. */
const skin = path.join(fixtures, "e2e-skin");
mkdirSync(path.join(skin, "fonts"), { recursive: true });
writeFileSync(
  path.join(skin, "skin.json"),
  JSON.stringify({
    id: "e2e-skin",
    name: "E2E Skin",
    version: "0.1.0",
    kind: "skin",
    api: 1,
    description: "Every field of a skin, for the end-to-end suite.",
    scheme: "both",
    tokens: {
      dark: { "--bg": "rgb(10, 20, 30)", "--bg-2": "rgb(20, 30, 40)", "--fg": "rgb(240, 240, 240)" },
      light: { "--bg": "rgb(250, 240, 230)", "--bg-2": "rgb(255, 250, 245)", "--fg": "rgb(30, 20, 10)" },
    },
    fonts: [{ family: "E2E Sans", src: "fonts/e2e.woff2", weight: "200 900" }],
    typography: { ui: '"E2E Sans", serif', mono: '"E2E Mono", monospace' },
    shape: { radius: 2, hairline: 1.5, density: "comfortable" },
    css: "skin.css",
  }),
);
writeFileSync(path.join(skin, "fonts", "e2e.woff2"), "wOF2 (not a real font)");
writeFileSync(path.join(skin, "skin.css"), 'html[data-skin="e2e-skin"] body { --e2e-skin-css: on; }\n');
const brokenSkin = path.join(fixtures, "e2e-skin-broken");
mkdirSync(brokenSkin, { recursive: true });
writeFileSync(
  path.join(brokenSkin, "skin.json"),
  JSON.stringify({
    id: "e2e-skin-broken",
    name: "E2E Broken Skin",
    version: "0.0.1",
    kind: "skin",
    api: 1,
    scheme: "dark",
    tokens: { "--nope": "red" },
  }),
);
// The installer refuses a broken manifest, so the broken one is copied into place by hand.
execFileSync(process.execPath, [cli, "skin", "add", skin, "--state", stateDir]);

/** A view that "ships with the GUI": the suite's own bundled dir stands in for dist/bundled,
 *  so disabling it cannot touch the real Canvas and Office. */
const bundled = path.join(stateDir, "bundled-fixtures", "views", "e2e-bundled");
mkdirSync(bundled, { recursive: true });
writeFileSync(
  path.join(bundled, "theme.json"),
  JSON.stringify({ id: "e2e-bundled", name: "E2E Bundled", version: "0.1.0", api: 1 }),
);
writeFileSync(
  path.join(bundled, "index.js"),
  "export default { mount(el) { el.innerHTML = '<h1 class=\"e2e-bundled-title\">E2E Bundled</h1>'; return () => {}; } };\n",
);
args.push("--bundled-dir", path.dirname(bundled));
cpSync(brokenSkin, path.join(stateDir, "skins", "e2e-skin-broken"), { recursive: true });

process.argv = [process.argv[0], cli, ...args];
await import(cli);
