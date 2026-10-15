// SPDX-License-Identifier: Apache-2.0
// The last look before `npm publish`: what the tarball would carry. Fails when a source
// map slipped in, when the bundled views are missing (unless SPGUI_NO_BUNDLE=1), or when
// the bin, the web app or the README is not there. Run by the release workflow after the
// build; by hand: `npm run pack:check`.
import { spawnSync } from "node:child_process";

const r = spawnSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status ?? 1);
}
const [pkg] = JSON.parse(r.stdout);
const files = pkg.files.map((f) => f.path);
const problems = [];
const maps = files.filter((f) => f.endsWith(".map"));
if (maps.length) problems.push(`source maps in the tarball: ${maps.join(", ")}`);
for (const must of ["dist/cli.js", "dist/index.js", "dist/web/index.html", "README.md", "LICENSE", "NOTICE"]) {
  if (!files.includes(must)) problems.push(`missing ${must}`);
}
for (const view of ["canvas", "office"]) {
  if (!files.includes(`dist/bundled/views/${view}/theme.json`) && process.env.SPGUI_NO_BUNDLE !== "1")
    problems.push(`bundled view ${view} is missing (build with ../sessionpipe-gui-themes beside this repo)`);
}
const stray = files.filter((f) => /(^|\/)(test|e2e|__snapshots__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
if (stray.length) problems.push(`tests in the tarball: ${stray.join(", ")}`);
const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(
  `${pkg.name}@${pkg.version}: ${pkg.entryCount} files, ${kb(pkg.size)} packed, ${kb(pkg.unpackedSize)} unpacked`,
);
if (problems.length) {
  for (const p of problems) console.error(`  ✘ ${p}`);
  process.exit(1);
}
console.log("  ✔ no source maps, bin + web app + bundled views + README/LICENSE/NOTICE present");
