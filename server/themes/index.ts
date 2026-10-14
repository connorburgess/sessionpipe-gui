// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. Themes are plugins kept outside the GUI: installed under
// <stateDir>/themes/<id>/, served at /themes/<id>/ and imported by the page at runtime.
// The contract they are written against is shared/theme-api.ts.
export { addTheme, formatList, linkTheme, listThemes, removeTheme, ThemeInstallError } from "./install.js";
export { publicTheme, readManifest, type ThemeEntry, ThemeRegistry, validateManifest } from "./registry.js";
export { registerThemes, resolveInside, STATE_MAX_BYTES } from "./routes.js";
