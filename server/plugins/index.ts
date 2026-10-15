// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. Plugins are server-side extensions kept outside the GUI: installed
// under <stateDir>/plugins/<id>/ and imported into the receiver process at boot and on
// reload. The contract they are written against is shared/plugin-api.ts; the installer
// they share with views is server/extensions.
export { ACTIVATE_TIMEOUT_MS, PluginHost, type PluginHostDeps, STORAGE_MAX_BYTES } from "./host.js";
export { addPlugin, formatPluginList, linkPlugin, listPlugins, removePlugin } from "./install.js";
export {
  checkValue,
  type PluginEntry,
  PluginRegistry,
  type PluginRegistryOptions,
  pluginKind,
  readPluginManifest,
  validatePluginManifest,
} from "./registry.js";
export { registerPlugins, SETTINGS_MAX_BYTES } from "./routes.js";
export { PluginSettings, SettingsError } from "./settings.js";
