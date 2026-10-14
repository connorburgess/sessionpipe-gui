// SPDX-License-Identifier: Apache-2.0
// Bundles the server to dist/*.js with esbuild. `--watch` rebuilds on change.
// The web app is built separately by Vite into dist/web (see package.json).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
mkdirSync(path.join(root, "dist"), { recursive: true });

const options = {
  entryPoints: {
    cli: path.join(root, "server/cli.ts"),
    index: path.join(root, "server/index.ts"),
    conformance: path.join(root, "server/conformance/cli.ts"),
  },
  outdir: path.join(root, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
