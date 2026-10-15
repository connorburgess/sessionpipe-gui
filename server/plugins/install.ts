// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. `sessionpipe-gui plugin …`: list, add, link and remove plugins under
// the plugins dir. The work is the shared installer in server/extensions/install.ts;
// this file binds it to the plugin kind (plugin.json).
import type { PluginManifest } from "../../shared/plugin-api.js";
import {
  addExtension,
  formatEntries,
  InstallError,
  type InstallResult,
  linkExtension,
  removeExtension,
} from "../extensions/install.js";
import { type PluginEntry, PluginRegistry, type PluginRegistryOptions, pluginKind } from "./registry.js";

/** Installed and bundled, as the server lists them. */
export function listPlugins(pluginsDir: string, opts?: PluginRegistryOptions): PluginEntry[] {
  return new PluginRegistry(pluginsDir, opts).list();
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
      flags: [p.linked ? "linked" : "", p.bundled ? "bundled" : "", p.disabled ? "disabled" : ""],
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

/** Remove an installed plugin. A bundled one has no folder to remove: the message says to
 *  disable it instead (`plugin disable <id>`). */
export function removePlugin(
  pluginsDir: string,
  id: string,
  opts?: PluginRegistryOptions,
): { dir: string; message: string } {
  try {
    return removeExtension(pluginKind(pluginsDir), id);
  } catch (e) {
    if (e instanceof InstallError && new PluginRegistry(pluginsDir, opts).isBundled(id)) {
      throw new InstallError(
        `${id} is bundled with sessionpipe-gui and cannot be removed; \`sessionpipe-gui plugin disable ${id}\` turns it off (\`plugin enable ${id}\` turns it on)`,
      );
    }
    throw e;
  }
}
