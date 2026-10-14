// SPDX-License-Identifier: Apache-2.0
// One command for development: the server (rebuilt and restarted on change) on :7373
// and Vite on :5173 proxying to it. Open http://localhost:5173.
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extra = process.argv.slice(2);

const run = (cmd, args, opts = {}) => spawn(cmd, args, { stdio: "inherit", cwd: root, ...opts });
run("node", ["scripts/build.mjs", "--watch"]);
run("npx", ["vite", "--config", "web/vite.config.ts"]);

let server = null;
let timer = null;
const restart = () => {
  if (server) server.kill();
  server = run("node", ["dist/cli.js", ...extra], { env: { ...process.env, SESSIONPIPE_GUI_DEV: "1" } });
};
setTimeout(restart, 1500);
watch(path.join(root, "dist"), { recursive: false }, (_e, f) => {
  if (!f || !f.endsWith(".js")) return;
  clearTimeout(timer);
  timer = setTimeout(restart, 300);
});
process.on("SIGINT", () => {
  server?.kill();
  process.exit(0);
});
