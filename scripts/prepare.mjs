// SPDX-License-Identifier: Apache-2.0
// `npm install` from a git URL (npx github:spacesheep-dev/sessionpipe-gui, or a clone)
// runs this: build once so the CLI exists, with Canvas and Office from the tracked
// bundled/ copy when the themes repo isn't beside us. A checkout that already has a
// build (a contributor's `npm ci`) is left alone; `npm run build` is the explicit way.
// npm's git preparation does not always have the dev dependencies in place when this
// runs, so the build tools are installed here if they are missing.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.SPGUI_SKIP_PREPARE === "1") process.exit(0);
if (existsSync(path.join(root, "dist", "cli.js")) && existsSync(path.join(root, "dist", "web", "index.html"))) {
  process.exit(0);
}
const require = createRequire(path.join(root, "package.json"));
const haveTools = ["esbuild", "vite", "@vitejs/plugin-react", "react", "react-dom"].every((m) => {
  try {
    require.resolve(`${m}/package.json`);
    return true;
  } catch {
    return false;
  }
});
if (!haveTools) {
  console.log("sessionpipe-gui: installing build tools (one time)…");
  const i = spawnSync(
    "npm",
    ["install", "--include=dev", "--no-save", "--no-audit", "--no-fund", "--ignore-scripts", "--silent"],
    { cwd: root, stdio: "inherit" },
  );
  if (i.status !== 0) process.exit(i.status ?? 1);
}
const r = spawnSync("npm", ["run", "build", "--silent"], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
