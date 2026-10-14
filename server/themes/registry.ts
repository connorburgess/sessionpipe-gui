// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. The installed themes: one folder per theme under
// <stateDir>/themes/<id>/ with a theme.json (ThemeManifest) and the entry module.
// Scanned at boot and on POST /api/ui/themes/reload. A folder whose manifest is wrong
// is still listed, with `error`, so the problem shows instead of the theme vanishing.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { type InstalledTheme, THEME_API_VERSION, THEME_ID_RE, type ThemeManifest } from "../../shared/theme-api.js";

/** Everything the server knows about one installed theme. */
export interface ThemeEntry extends InstalledTheme {
  /** Where the files are (the folder, or the symlink). Always set server-side. */
  dir: string;
}

export const FILES_PREFIX = "/themes";

/** Read and validate a theme.json; throws with a message for the person. */
export function readManifest(dir: string): ThemeManifest {
  const file = path.join(dir, "theme.json");
  if (!existsSync(file)) throw new Error("no theme.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`theme.json is not valid JSON: ${(e as Error).message}`);
  }
  return validateManifest(raw, dir);
}

export function validateManifest(raw: unknown, dir?: string): ThemeManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("theme.json must be an object");
  const m = raw as Record<string, unknown>;
  const str = (k: string, required: boolean): string | undefined => {
    const v = m[k];
    if (v === undefined || v === null) {
      if (required) throw new Error(`theme.json: "${k}" is required`);
      return undefined;
    }
    if (typeof v !== "string") throw new Error(`theme.json: "${k}" must be a string`);
    return v;
  };
  const id = str("id", true)!;
  if (!THEME_ID_RE.test(id)) throw new Error(`theme.json: id "${id}" must match ${THEME_ID_RE}`);
  const name = str("name", true)!;
  const version = str("version", true)!;
  const api = m.api;
  if (!Number.isInteger(api) || (api as number) < 1) throw new Error('theme.json: "api" must be a positive integer');
  if ((api as number) > THEME_API_VERSION) {
    throw new Error(`theme.json: api ${api} is newer than this host's ${THEME_API_VERSION}`);
  }
  const entry = str("entry", false) ?? "index.js";
  if (!isRelativeFile(entry)) throw new Error(`theme.json: entry "${entry}" must be a relative path inside the theme`);
  const style = str("style", false);
  if (style !== undefined && !isRelativeFile(style)) {
    throw new Error(`theme.json: style "${style}" must be a relative path inside the theme`);
  }
  if (dir && !existsSync(path.join(dir, entry))) throw new Error(`entry "${entry}" is missing`);
  if (dir && style && !existsSync(path.join(dir, style))) throw new Error(`style "${style}" is missing`);
  const experimental = m.experimental;
  if (experimental !== undefined && typeof experimental !== "boolean") {
    throw new Error('theme.json: "experimental" must be a boolean');
  }
  const out: ThemeManifest = { id, name, version, api: api as number, entry };
  const description = str("description", false);
  if (description !== undefined) out.description = description;
  if (style !== undefined) out.style = style;
  const icon = str("icon", false);
  if (icon !== undefined) out.icon = icon;
  if (experimental !== undefined) out.experimental = experimental;
  const source = str("source", false);
  if (source !== undefined) out.source = source;
  return out;
}

/** A relative path that stays inside the folder: no absolute, no `..`, no scheme. */
export function isRelativeFile(p: string): boolean {
  if (!p || path.isAbsolute(p) || p.startsWith("/") || p.startsWith("\\") || /^[a-z]+:/i.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return parts.every((s) => s !== "" && s !== ".." && s !== ".");
}

export class ThemeRegistry {
  private entries = new Map<string, ThemeEntry>();

  constructor(readonly themesDir: string) {
    this.scan();
  }

  /** Re-read every folder under the themes dir. Never throws: a missing dir is empty. */
  scan(): ThemeEntry[] {
    const next = new Map<string, ThemeEntry>();
    let names: string[] = [];
    try {
      names = readdirSync(this.themesDir);
    } catch {
      names = [];
    }
    for (const name of names.sort()) {
      if (name.startsWith(".")) continue; // .npm and the like
      const dir = path.join(this.themesDir, name);
      let linked = false;
      try {
        linked = lstatSync(dir).isSymbolicLink();
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        if (linked) next.set(name, broken(name, dir, linked, "linked folder is missing"));
        continue;
      }
      try {
        const manifest = readManifest(dir);
        if (manifest.id !== name) {
          next.set(
            name,
            broken(name, dir, linked, `theme.json id "${manifest.id}" does not match the folder "${name}"`),
          );
          continue;
        }
        const entry: ThemeEntry = { ...manifest, url: `${FILES_PREFIX}/${name}/`, dir };
        if (linked) {
          entry.linked = true;
          entry.source ??= `link:${realpathSync(dir)}`;
        }
        next.set(name, entry);
      } catch (e) {
        next.set(name, broken(name, dir, linked, (e as Error).message));
      }
    }
    this.entries = next;
    return this.list();
  }

  list(): ThemeEntry[] {
    return [...this.entries.values()];
  }

  /** A loadable theme (no error) by id. */
  get(id: string): ThemeEntry | undefined {
    const t = this.entries.get(id);
    return t && !t.error ? t : undefined;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }
}

function broken(name: string, dir: string, linked: boolean, error: string): ThemeEntry {
  const t: ThemeEntry = { id: name, name, version: "", api: 0, url: `${FILES_PREFIX}/${name}/`, dir, error };
  if (linked) t.linked = true;
  return t;
}

/** The listing as the UI API sends it: `dir` only to this machine. */
export function publicTheme(t: ThemeEntry, loopback: boolean): InstalledTheme {
  if (loopback) return t;
  const { dir: _dir, ...rest } = t;
  return rest;
}
