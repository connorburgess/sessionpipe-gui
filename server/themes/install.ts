// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. `sessionpipe-gui theme …`: list, add, link and remove themes under
// the themes dir. `add` takes a folder (copied), a .tgz/.zip file or URL (downloaded,
// extracted with tar / unzip), or an npm spec (package name, git URL, file:…) which
// goes through `npm install` into <themesDir>/.npm and is copied from there. The id
// always comes from the theme's own theme.json; the installed copy records `source`.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ThemeManifest } from "../../shared/theme-api.js";
import { readManifest, type ThemeEntry, ThemeRegistry } from "./registry.js";

export class ThemeInstallError extends Error {}

export interface InstallResult {
  manifest: ThemeManifest;
  dir: string;
  /** What happened, one line for the terminal. */
  message: string;
  replaced: boolean;
}

export function listThemes(themesDir: string): ThemeEntry[] {
  return new ThemeRegistry(themesDir).list();
}

/** One line per theme, for `theme list`. */
export function formatList(themesDir: string, themes: ThemeEntry[]): string {
  if (themes.length === 0) return `no themes installed in ${themesDir}\n`;
  const lines = themes.map((t) => {
    const flags = [t.linked ? "linked" : "", t.experimental ? "experimental" : ""].filter(Boolean);
    const head = t.error
      ? `${t.id.padEnd(20)} (broken: ${t.error})`
      : `${t.id.padEnd(20)} ${t.name} ${t.version}${flags.length ? `  [${flags.join(", ")}]` : ""}`;
    const tail = t.source ? `  ← ${t.source}` : "";
    return `${head}${tail}\n    ${t.dir}`;
  });
  return `${lines.join("\n")}\n`;
}

const isUrl = (s: string): boolean => /^https?:\/\//i.test(s);
/** A local path by its spelling (absolute, ./, ../, ~), as opposed to a package name. */
const looksLikePath = (s: string): boolean => path.isAbsolute(s) || /^(\.\.?[\\/]|\.\.?$|~)/.test(s);
const isArchive = (s: string): boolean => /\.(tgz|tar\.gz|zip)(\?.*)?$/i.test(s);

/** Install from a folder, an archive (path or URL) or an npm spec. */
export async function addTheme(themesDir: string, source: string): Promise<InstallResult> {
  if (!source)
    throw new ThemeInstallError("theme add needs a source: a folder, a .tgz/.zip, an npm package or a git URL");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "spgui-theme-"));
  try {
    if (!isUrl(source) && !source.startsWith("file:") && existsSync(source)) {
      const abs = path.resolve(source);
      if (lstatSync(abs).isDirectory()) return installFrom(themesDir, abs, abs, "folder");
      if (isArchive(abs)) return installFrom(themesDir, extract(abs, tmp), abs, "archive");
      throw new ThemeInstallError(`${source} is neither a folder nor a .tgz/.zip`);
    }
    if (looksLikePath(source)) throw new ThemeInstallError(`${source} does not exist`);
    if (isUrl(source) && isArchive(source)) {
      const file = await download(source, tmp);
      return installFrom(themesDir, extract(file, tmp), source, "archive");
    }
    if (!isUrl(source) || /^(git\+)?https?:\/\/.*\.git$/i.test(source) || /^https?:\/\/github\.com\//i.test(source)) {
      return installFrom(themesDir, npmInstall(themesDir, source), `npm:${source}`, "npm");
    }
    throw new ThemeInstallError(
      `cannot install from ${source}: give a folder, a .tgz/.zip, an npm package or a git URL`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Symlink a folder for development: edits show on the next page load. */
export function linkTheme(themesDir: string, folder: string): InstallResult {
  const abs = path.resolve(folder);
  if (!existsSync(abs) || !lstatSync(abs).isDirectory()) throw new ThemeInstallError(`${folder} is not a folder`);
  const manifest = readManifestOrThrow(abs);
  mkdirSync(themesDir, { recursive: true });
  const dest = path.join(themesDir, manifest.id);
  const replaced = removeDir(dest);
  symlinkSync(abs, dest, "dir");
  return {
    manifest,
    dir: dest,
    replaced,
    message: `${replaced ? "replaced" : "linked"} ${manifest.id} (${manifest.name} ${manifest.version}) → ${abs}`,
  };
}

export function removeTheme(themesDir: string, id: string): { dir: string; message: string } {
  const dest = path.join(themesDir, id);
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(id) || (!existsSync(dest) && !isSymlink(dest))) {
    throw new ThemeInstallError(`no theme "${id}" in ${themesDir}`);
  }
  const linked = isSymlink(dest);
  removeDir(dest);
  return { dir: dest, message: `removed ${id}${linked ? " (the link; the folder it pointed to is untouched)" : ""}` };
}

// ---------- pieces ----------

function installFrom(
  themesDir: string,
  from: string,
  source: string,
  how: "folder" | "archive" | "npm",
): InstallResult {
  const root = findThemeRoot(from);
  const manifest = readManifestOrThrow(root);
  mkdirSync(themesDir, { recursive: true });
  const dest = path.join(themesDir, manifest.id);
  if (realpathSafe(root) === realpathSafe(dest)) {
    throw new ThemeInstallError(`${root} is already the installed copy of ${manifest.id}`);
  }
  const replaced = removeDir(dest);
  cpSync(root, dest, { recursive: true, dereference: true, filter: (p) => path.basename(p) !== "node_modules" });
  const installed: ThemeManifest = { ...manifest, source };
  writeFileSync(path.join(dest, "theme.json"), `${JSON.stringify(installed, null, 2)}\n`);
  const verb = replaced ? "replaced" : "installed";
  return {
    manifest: installed,
    dir: dest,
    replaced,
    message: `${verb} ${manifest.id} (${manifest.name} ${manifest.version}) from ${how === "folder" ? from : source.replace(/^npm:/, "")}\n    ${dest}`,
  };
}

function readManifestOrThrow(dir: string): ThemeManifest {
  try {
    return readManifest(dir);
  } catch (e) {
    throw new ThemeInstallError(`${dir}: ${(e as Error).message}`);
  }
}

/** theme.json at the top, or one folder down (an archive's `package/`, a zip's
 *  `my-theme/`), or two down. */
function findThemeRoot(dir: string): string {
  const queue: [string, number][] = [[dir, 0]];
  while (queue.length) {
    const [d, depth] = queue.shift()!;
    if (existsSync(path.join(d, "theme.json"))) return d;
    if (depth >= 2) continue;
    for (const name of readdirSync(d).sort()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const sub = path.join(d, name);
      try {
        if (lstatSync(sub).isDirectory()) queue.push([sub, depth + 1]);
      } catch {}
    }
  }
  throw new ThemeInstallError(`no theme.json found in ${dir}`);
}

async function download(url: string, tmp: string): Promise<string> {
  const name = path.basename(new URL(url).pathname) || "theme.tgz";
  const file = path.join(tmp, name);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new ThemeInstallError(`download failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ThemeInstallError(`download failed: ${res.status} ${res.statusText} for ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function extract(file: string, tmp: string): string {
  const out = path.join(tmp, "unpacked");
  mkdirSync(out, { recursive: true });
  const zip = /\.zip$/i.test(file);
  const [cmd, args] = zip ? ["unzip", ["-q", "-o", file, "-d", out]] : ["tar", ["-xzf", file, "-C", out]];
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new ThemeInstallError(`${cmd} is not installed; it is needed to extract ${path.basename(file)}`);
  }
  if (r.status !== 0) throw new ThemeInstallError(`${cmd} failed on ${file}: ${(r.stderr || r.stdout).trim()}`);
  return out;
}

/** npm install into <themesDir>/.npm, then the package's folder in node_modules. */
function npmInstall(themesDir: string, spec: string): string {
  const prefix = path.join(themesDir, ".npm");
  mkdirSync(prefix, { recursive: true });
  const pkgFile = path.join(prefix, "package.json");
  if (!existsSync(pkgFile)) writeFileSync(pkgFile, '{ "name": "sessionpipe-gui-themes", "private": true }\n');
  const before = depsOf(pkgFile);
  const r = spawnSync(
    "npm",
    ["install", "--prefix", prefix, spec, "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock"],
    { encoding: "utf8", env: { ...process.env, NODE_ENV: "production" } },
  );
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new ThemeInstallError("npm is not installed; it is needed to install a package or a git URL");
  }
  if (r.status !== 0) throw new ThemeInstallError(`npm install ${spec} failed:\n${(r.stderr || r.stdout).trim()}`);
  const after = depsOf(pkgFile);
  const added = Object.keys(after).filter((k) => !(k in before));
  const bare = /^(@[^/@]+\/)?[^/@]+(?=@|$)/.exec(spec)?.[0];
  const name =
    added.length === 1 ? added[0]! : bare && existsSync(path.join(prefix, "node_modules", bare)) ? bare : null;
  if (name) return path.join(prefix, "node_modules", name);
  const candidates = Object.keys(after).filter((k) => existsSync(path.join(prefix, "node_modules", k, "theme.json")));
  if (candidates.length === 1) return path.join(prefix, "node_modules", candidates[0]!);
  throw new ThemeInstallError(
    `npm installed ${spec} but which package it is could not be told (${candidates.join(", ")})`,
  );
}

function depsOf(pkgFile: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { dependencies?: Record<string, string> };
    return pkg.dependencies ?? {};
  } catch {
    return {};
  }
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Remove a theme folder, or just the link when it is one. Returns whether anything was there. */
function removeDir(dest: string): boolean {
  if (isSymlink(dest)) {
    unlinkSync(dest);
    return true;
  }
  if (!existsSync(dest)) return false;
  rmSync(dest, { recursive: true, force: true });
  return true;
}

function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
