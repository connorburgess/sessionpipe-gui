// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. What the three kinds of extension have in common: a folder per id
// under a base dir, a manifest file beside the entry (theme.json, skin.json, plugin.json),
// a validator, and the scan that lists what is installed. Views (server/themes) and
// plugins (server/plugins) each describe themselves as an ExtensionKind and share the
// installer in ./install.ts; skins will do the same without a change here.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export type ExtensionKindName = "view" | "skin" | "plugin";

/** The least a manifest has; each kind's own type extends it. */
export interface BaseManifest {
  id: string;
  name: string;
  version: string;
  /** Where it came from (written by the installer, not by the author). */
  source?: string;
}

export interface ExtensionKind<M extends BaseManifest = BaseManifest> {
  kind: ExtensionKindName;
  /** The word used in messages: "theme", "skin", "plugin". */
  noun: string;
  /** The manifest file beside the entry module. */
  manifestFile: string;
  /** Where installed ones live: <stateDir>/themes, <stateDir>/skins, <stateDir>/plugins. */
  dir: string;
  /** Validate a parsed manifest; with `dir`, also check that the files it names exist.
   *  Throws an Error whose message is for the person. */
  validate(raw: unknown, dir?: string): M;
}

export const EXTENSION_ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

/** Read and validate the kind's manifest in `dir`; throws with a message for the person. */
export function readManifestOf<M extends BaseManifest>(kind: ExtensionKind<M>, dir: string): M {
  const file = path.join(dir, kind.manifestFile);
  if (!existsSync(file)) throw new Error(`no ${kind.manifestFile}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${kind.manifestFile} is not valid JSON: ${(e as Error).message}`);
  }
  return kind.validate(raw, dir);
}

/** A relative path that stays inside the folder: no absolute, no `..`, no scheme. */
export function isRelativeFile(p: string): boolean {
  if (!p || path.isAbsolute(p) || p.startsWith("/") || p.startsWith("\\") || /^[a-z]+:/i.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return parts.every((s) => s !== "" && s !== ".." && s !== ".");
}

/** One folder under the kind's dir, as the scan saw it. */
export interface ScannedFolder<M extends BaseManifest> {
  /** The folder name, which a valid manifest's id must equal. */
  id: string;
  dir: string;
  linked: boolean;
  manifest?: M;
  /** Why the folder cannot be used; the manifest is absent then. */
  error?: string;
}

/** Every folder under the kind's dir, sorted by name. Never throws: a missing dir is empty.
 *  A folder whose manifest is wrong is still listed, with `error`, so the problem shows. */
export function scanKind<M extends BaseManifest>(kind: ExtensionKind<M>): ScannedFolder<M>[] {
  let names: string[] = [];
  try {
    names = readdirSync(kind.dir);
  } catch {
    return [];
  }
  const out: ScannedFolder<M>[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue; // .npm and the like
    const dir = path.join(kind.dir, name);
    let linked = false;
    try {
      linked = lstatSync(dir).isSymbolicLink();
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      if (linked) out.push({ id: name, dir, linked, error: "linked folder is missing" });
      continue;
    }
    try {
      const manifest = readManifestOf(kind, dir);
      if (manifest.id !== name) {
        out.push({
          id: name,
          dir,
          linked,
          error: `${kind.manifestFile} id "${manifest.id}" does not match the folder "${name}"`,
        });
        continue;
      }
      if (linked) manifest.source ??= `link:${realpathSync(dir)}`;
      out.push({ id: name, dir, linked, manifest });
    } catch (e) {
      out.push({ id: name, dir, linked, error: (e as Error).message });
    }
  }
  return out;
}
