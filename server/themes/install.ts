// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. `sessionpipe-gui view …` (alias `theme …`): list, add, link and
// remove views under the themes dir. The work is the shared installer in
// server/extensions/install.ts; this file binds it to the view kind (theme.json).
import type { ThemeManifest } from "../../shared/theme-api.js";
import {
  addExtension,
  formatEntries,
  type InstallResult as GenericInstallResult,
  InstallError,
  linkExtension,
  removeExtension,
} from "../extensions/install.js";
import { type ThemeEntry, ThemeRegistry, viewKind } from "./registry.js";

export const ThemeInstallError = InstallError;
export type ThemeInstallError = InstallError;

export type InstallResult = GenericInstallResult<ThemeManifest>;

export function listThemes(themesDir: string): ThemeEntry[] {
  return new ThemeRegistry(themesDir).list();
}

/** One line per theme, for `view list`. */
export function formatList(themesDir: string, themes: ThemeEntry[]): string {
  return formatEntries(
    viewKind(themesDir),
    themes.map((t) => ({ ...t, flags: [t.linked ? "linked" : "", t.experimental ? "experimental" : ""] })),
  );
}

/** Install from a folder, an archive (path or URL) or an npm spec. */
export function addTheme(themesDir: string, source: string): Promise<InstallResult> {
  return addExtension(viewKind(themesDir), source);
}

/** Symlink a folder for development: edits show on the next page load. */
export function linkTheme(themesDir: string, folder: string): InstallResult {
  return linkExtension(viewKind(themesDir), folder);
}

export function removeTheme(themesDir: string, id: string): { dir: string; message: string } {
  return removeExtension(viewKind(themesDir), id);
}
