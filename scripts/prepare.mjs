// SPDX-License-Identifier: Apache-2.0
// `npm install` from a git URL (npx github:spacesheep-dev/sessionpipe-gui, or a clone)
// runs this: build once so the CLI exists, with Canvas and Office from the tracked
// bundled/ copy when the themes repo isn't beside us. A checkout that already has a
// build (a contributor's `npm ci`) is left alone; `npm run build` is the explicit way.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(path.join(root, "dist", "cli.js")) && existsSync(path.join(root, "dist", "web", "index.html"))) {
  process.exit(0);
}
if (process.env.SPGUI_SKIP_PREPARE === "1") process.exit(0);
const r = spawnSync("npm", ["run", "build", "--silent"], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
