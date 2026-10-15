// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. The curated extras: the official views, skins and plugins from
// sessionpipe-gui-themes, by id, with the npm package each one installs from.
// `sessionpipe-gui extras list|add <id|all>` and the Views page's Extras list both read
// this. Canvas and Office are bundled into the package (scripts/build.mjs) and are listed
// so the catalogue is the whole picture; `extras add` has nothing to do for them.
// Sizes are the npm tarballs as packed at 0.1.0 (`npm pack --dry-run`), rounded.
import type { ExtraEntry } from "../../shared/api.js";

export const EXTRAS: readonly ExtraEntry[] = [
  {
    id: "canvas",
    kind: "view",
    name: "Canvas",
    npm: "@sessionpipe-gui/theme-canvas",
    line: "Every live session as a window on an infinite canvas; the Map draws devices, accounts, machines and repos around them.",
    size: "39 kB",
    bundled: true,
  },
  {
    id: "office",
    kind: "view",
    name: "Office",
    npm: "@sessionpipe-gui/theme-office",
    line: "Every machine a room, every live session a person at a desk; posture is the state, amber marks who needs you.",
    size: "36 kB",
    bundled: true,
  },
  {
    id: "spacesheep-vivid",
    kind: "skin",
    name: "Spacesheep Vivid",
    npm: "@sessionpipe-gui/skin-spacesheep-vivid",
    line: "Spacesheep with the surfaces carrying the brand: deep indigo cards on violet-black, soft lavender on warm cream.",
    size: "59 kB",
  },
  {
    id: "paper-serif",
    kind: "skin",
    name: "Paper Serif",
    npm: "@sessionpipe-gui/skin-paper-serif",
    line: "Warm paper, a bundled serif (Source Serif 4, OFL) for the interface text, square corners, roomier rows. Light only.",
    size: "819 kB",
  },
  {
    id: "ping-a-human",
    kind: "plugin",
    name: "ping-a-human",
    npm: "@sessionpipe-gui/plugin-ping-a-human",
    line: "A Telegram message when a session needs you; Allow / Deny taps come back as suggestions you confirm with a passkey.",
    size: "27 kB",
  },
];

export function findExtra(id: string): ExtraEntry | undefined {
  return EXTRAS.find((e) => e.id === id);
}

/** The ones `extras add all` installs: everything that is not already in the package. */
export function installableExtras(): ExtraEntry[] {
  return EXTRAS.filter((e) => !e.bundled);
}

/** One line per entry, for `extras list`. */
export function formatCatalog(installed: (e: ExtraEntry) => boolean): string {
  const lines = EXTRAS.map((e) => {
    const state = e.bundled ? "bundled" : installed(e) ? "installed" : "";
    const head = `${e.id.padEnd(18)} ${e.kind.padEnd(7)} ${e.name}${state ? `  [${state}]` : ""}`;
    return `${head}\n    ${e.line}\n    ${e.npm} · ${e.size}`;
  });
  return `${lines.join("\n")}\n`;
}
