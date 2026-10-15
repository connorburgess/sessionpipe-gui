// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. The installed views (themes): one folder per theme under
// <stateDir>/themes/<id>/ with a theme.json (ThemeManifest) and the entry module.
// Scanned at boot and on POST /api/ui/themes/reload. A folder whose manifest is wrong
// is still listed, with `error`, so the problem shows instead of the theme vanishing.
// The folder layout, the scan and the installer are shared with the other kinds of
// extension (server/extensions); this file is what makes a view a view.
import { existsSync } from "node:fs";
import path from "node:path";
import { type InstalledTheme, THEME_API_VERSION, THEME_ID_RE, type ThemeManifest } from "../../shared/theme-api.js";
import { type ExtensionKind, isRelativeFile, readManifestOf, scanKind } from "../extensions/kind.js";

/** Everything the server knows about one installed theme. */
export interface ThemeEntry extends InstalledTheme {
  /** Where the files are (the folder, or the symlink). Always set server-side. */
  dir: string;
}

export const FILES_PREFIX = "/themes";

/** The view kind, for the shared installer and scan: theme.json under `dir`. */
export function viewKind(dir: string): ExtensionKind<ThemeManifest> {
  return { kind: "view", noun: "theme", manifestFile: "theme.json", dir, validate: validateManifest };
}

/** Read and validate a theme.json; throws with a message for the person. */
export function readManifest(dir: string): ThemeManifest {
  return readManifestOf(viewKind(path.dirname(dir)), dir);
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

export { isRelativeFile };

export class ThemeRegistry {
  private entries = new Map<string, ThemeEntry>();

  constructor(readonly themesDir: string) {
    this.scan();
  }

  /** Re-read every folder under the themes dir. Never throws: a missing dir is empty. */
  scan(): ThemeEntry[] {
    const next = new Map<string, ThemeEntry>();
    for (const f of scanKind(viewKind(this.themesDir))) {
      const url = `${FILES_PREFIX}/${f.id}/`;
      const entry: ThemeEntry = f.manifest
        ? { ...f.manifest, url, dir: f.dir }
        : { id: f.id, name: f.id, version: "", api: 0, url, dir: f.dir, error: f.error ?? "unreadable" };
      if (f.linked) entry.linked = true;
      next.set(f.id, entry);
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

/** The listing as the UI API sends it: `dir` only to this machine. */
export function publicTheme(t: ThemeEntry, loopback: boolean): InstalledTheme {
  if (loopback) return t;
  const { dir: _dir, ...rest } = t;
  return rest;
}
