// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. `sessionpipe-gui skin …`: list, add, link and remove skins under the
// skins dir. The work is the shared installer in server/extensions/install.ts; this file
// binds it to the skin kind (skin.json).
import type { SkinManifest } from "../../shared/skin-api.js";
import {
  addExtension,
  formatEntries,
  type InstallResult,
  linkExtension,
  removeExtension,
} from "../extensions/install.js";
import { type SkinEntry, SkinRegistry, skinKind } from "./registry.js";

/** The installed packages only (what `skin list` manages); built-ins and color-theme
 *  files are not folders under the skins dir. */
export function listSkins(skinsDir: string): SkinEntry[] {
  return new SkinRegistry(skinsDir).list().filter((s) => s.source === "skin");
}

/** One line per skin, for `skin list`. */
export function formatSkinList(skinsDir: string, skins: SkinEntry[]): string {
  return formatEntries(
    skinKind(skinsDir),
    skins.map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      dir: s.dir ?? "",
      source: s.origin,
      error: s.error,
      flags: [s.linked ? "linked" : "", s.error ? "" : s.scheme],
    })),
  );
}

/** Install from a folder, an archive (path or URL) or an npm spec. */
export function addSkin(skinsDir: string, source: string): Promise<InstallResult<SkinManifest>> {
  return addExtension(skinKind(skinsDir), source);
}

/** Symlink a folder for development: edits show on the next open of the popover. */
export function linkSkin(skinsDir: string, folder: string): InstallResult<SkinManifest> {
  return linkExtension(skinKind(skinsDir), folder);
}

export function removeSkin(skinsDir: string, id: string): { dir: string; message: string } {
  return removeExtension(skinKind(skinsDir), id);
}
