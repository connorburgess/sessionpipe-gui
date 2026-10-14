// SPDX-License-Identifier: Apache-2.0
// The e2e web server: installs two fixture themes into the e2e state dir with the real
// CLI (`theme add`) and then starts the server in this process, so the themes are there
// at boot. Playwright's webServer runs before globalSetup, which is why the install
// cannot live there. Arguments are passed through to the server unchanged.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
      <p>viewers <b data-viewers>0</b> · me <code data-me></code> · <b data-current></b> · ids <code data-ids></code></p>\`;
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
    return () => { unsubscribe(); window.__e2eThemeUnmounted = (window.__e2eThemeUnmounted ?? 0) + 1; };
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

process.argv = [process.argv[0], cli, ...args];
await import(cli);
