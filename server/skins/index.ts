// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. Skins are token/font/CSS packages kept outside the GUI: installed
// under <stateDir>/skins/<id>/, served at /skins/<id>/ and applied by the page without
// any code of their own. The contract they are written against is shared/skin-api.ts;
// the installer they share with views and plugins is server/extensions.
export { addSkin, formatSkinList, linkSkin, listSkins, removeSkin } from "./install.js";
export {
  contrastWarning,
  publicSkin,
  readSkinManifest,
  type SkinEntry,
  SkinRegistry,
  type SkinRegistryOptions,
  skinFromManifest,
  skinKind,
  validateSkinManifest,
} from "./registry.js";
export { registerSkins } from "./routes.js";
