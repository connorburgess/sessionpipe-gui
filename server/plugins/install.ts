// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. `sessionpipe-gui plugin …`: list, add, link and remove plugins under
// the plugins dir. The work is the shared installer in server/extensions/install.ts;
// this file binds it to the plugin kind (plugin.json).
import type { PluginManifest } from "../../shared/plugin-api.js";
import {
  addExtension,
  formatEntries,
  type InstallResult,
  linkExtension,
  removeExtension,
} from "../extensions/install.js";
import { type PluginEntry, PluginRegistry, pluginKind } from "./registry.js";

export function listPlugins(pluginsDir: string): PluginEntry[] {
  return new PluginRegistry(pluginsDir).list();
}

/** One line per plugin, for `plugin list`. */
export function formatPluginList(pluginsDir: string, plugins: PluginEntry[]): string {
  return formatEntries(
    pluginKind(pluginsDir),
    plugins.map((p) => ({
      id: p.id,
      name: p.manifest?.name ?? p.id,
      version: p.manifest?.version ?? "",
      dir: p.dir,
      source: p.manifest?.source,
      error: p.error,
      flags: [p.linked ? "linked" : ""],
    })),
  );
}

/** Install from a folder, an archive (path or URL) or an npm spec. */
export function addPlugin(pluginsDir: string, source: string): Promise<InstallResult<PluginManifest>> {
  return addExtension(pluginKind(pluginsDir), source);
}

/** Symlink a folder for development: the next reload imports the edited code. */
export function linkPlugin(pluginsDir: string, folder: string): InstallResult<PluginManifest> {
  return linkExtension(pluginKind(pluginsDir), folder);
}

export function removePlugin(pluginsDir: string, id: string): { dir: string; message: string } {
  return removeExtension(pluginKind(pluginsDir), id);
}
