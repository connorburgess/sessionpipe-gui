// SPDX-License-Identifier: Apache-2.0
// Bundles the server to dist/*.js with esbuild. `--watch` rebuilds on change.
// The web app is built separately by Vite into dist/web (see package.json).
//
// Bundled extensions: the views that ship with the GUI (Canvas and Office) are copied
// into dist/bundled/views/<id>/ from the themes repo's packages, built first with their
// own `npm run build`. `--bundle-from <path>` names that checkout (default: the sibling
// ../sessionpipe-gui-themes); when it is absent the step is skipped with a note, so a
// bare clone still builds. `--no-bundle` skips it. The themes repo stays the source of
// truth: nothing is copied into this repo's git, dist/ is ignored.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const watch = argv.includes("--watch");
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

/** The packages that ship with the GUI: kind → themes-repo package folder. */
const BUNDLED = [
  { kind: "views", pkg: "packages/canvas", manifest: "theme.json" },
  { kind: "views", pkg: "packages/office", manifest: "theme.json" },
];

function bundleExtensions() {
  const i = argv.indexOf("--bundle-from");
  const from = path.resolve(root, i >= 0 ? argv[i + 1] : "../sessionpipe-gui-themes");
  const out = path.join(root, "dist", "bundled");
  if (!existsSync(path.join(from, "packages"))) {
    console.log(`bundled extensions: skipped (no themes repo at ${from}; --bundle-from <path> names one)`);
    return;
  }
  rmSync(out, { recursive: true, force: true });
  for (const b of BUNDLED) {
    const pkg = path.join(from, b.pkg);
    const manifestFile = path.join(pkg, b.manifest);
    if (!existsSync(manifestFile)) {
      console.log(`bundled extensions: skipped ${b.pkg} (no ${b.manifest})`);
      continue;
    }
    const r = spawnSync("npm", ["run", "build", "--silent"], { cwd: pkg, encoding: "utf8" });
    if (r.status !== 0) {
      console.log(`bundled extensions: skipped ${b.pkg} (its build failed)\n${(r.stderr || r.stdout).trim()}`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    const dest = path.join(out, b.kind, manifest.id);
    mkdirSync(dest, { recursive: true });
    cpSync(manifestFile, path.join(dest, b.manifest));
    // The built files without their source maps: half the weight, and nobody debugs a
    // bundled view from the npm package (the themes repo has the sources).
    cpSync(path.join(pkg, "dist"), path.join(dest, "dist"), {
      recursive: true,
      dereference: true,
      filter: (p) => !p.endsWith(".map"),
    });
    for (const extra of ["README.md", "LICENSE", "DESIGN.md"]) {
      if (existsSync(path.join(pkg, extra))) cpSync(path.join(pkg, extra), path.join(dest, extra));
    }
    console.log(`bundled extensions: ${b.kind}/${manifest.id} ${manifest.version} ← ${b.pkg}`);
  }
}

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
  if (!argv.includes("--no-bundle")) bundleExtensions();
}
