// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. The skins the page can pick from, as one list: the built-ins
// (shared/skins-builtin.ts), the color-theme JSON files under <stateDir>/color-themes/
// (token-only skins, kept working as they were) and the installed packages under
// <stateDir>/skins/<id>/ with a skin.json (SkinManifest), then the skins that ship with
// the GUI (dist/bundled/skins, scripts/build.mjs): listed after the person's own, so an
// install of the same id overrides the bundled copy; `bundled: true`, `origin: "bundled"`,
// removable only by disabling (config.json `disabled`, as `skin:<id>`). Scanned at boot
// and on POST /api/ui/skins/reload. A package whose manifest is wrong is still listed,
// with `error`, so the problem shows instead of the skin vanishing. The folder layout,
// the scan and the installer are shared with views and plugins (server/extensions); this
// file is what makes a skin a skin.
import { existsSync } from "node:fs";
import path from "node:path";
import { COLOR_TOKEN_NAMES, COLOR_TOKEN_VALUE } from "../../shared/color-theme.js";
import { textTierWarnings } from "../../shared/contrast.js";
import {
  type InstalledSkin,
  SKIN_API_VERSION,
  SKIN_DENSITIES,
  SKIN_HAIRLINES,
  SKIN_ID_RE,
  SKIN_RADIUS_MAX,
  SKIN_ROUTES,
  SKIN_SCALE_MAX,
  SKIN_SCALE_MIN,
  SKIN_STYLE_TOKEN_NAMES,
  type SkinDensity,
  type SkinFont,
  type SkinHairline,
  type SkinManifest,
  type SkinShape,
  type SkinTokens,
  type SkinTypography,
} from "../../shared/skin-api.js";
import { BUILTIN_SKINS } from "../../shared/skins-builtin.js";
import {
  bundledDir,
  type ExtensionKind,
  isRelativeFile,
  readManifestOf,
  type ScannedFolder,
  scanKind,
} from "../extensions/kind.js";
import { readColorThemes } from "../ui/colorThemes.js";

/** Everything the server knows about one listed skin. */
export type SkinEntry = InstalledSkin;

/** The skin kind, for the shared installer and scan: skin.json under `dir`. */
export function skinKind(dir: string): ExtensionKind<SkinManifest> {
  return { kind: "skin", noun: "skin", manifestFile: "skin.json", dir, validate: validateSkinManifest };
}

/** Read and validate a skin.json; throws with a message for the person. */
export function readSkinManifest(dir: string): SkinManifest {
  return readManifestOf(skinKind(path.dirname(dir)), dir);
}

const FONT_EXT = /\.(woff2|woff|ttf|otf)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|svg|avif)$/i;
/** A font stack or a style value: no braces, semicolons, angle brackets or url(). */
const STYLE_VALUE = /^(?!.*url\()[^;{}<>]{1,200}$/i;

export function validateSkinManifest(raw: unknown, dir?: string): SkinManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("skin.json must be an object");
  const m = raw as Record<string, unknown>;
  const str = (k: string, required: boolean): string | undefined => {
    const v = m[k];
    if (v === undefined || v === null) {
      if (required) throw new Error(`skin.json: "${k}" is required`);
      return undefined;
    }
    if (typeof v !== "string") throw new Error(`skin.json: "${k}" must be a string`);
    return v;
  };
  const id = str("id", true)!;
  if (!SKIN_ID_RE.test(id)) throw new Error(`skin.json: id "${id}" must match ${SKIN_ID_RE}`);
  if (BUILTIN_SKINS.some((b) => b.id === id)) throw new Error(`skin.json: id "${id}" is a built-in skin`);
  const name = str("name", true)!;
  if (!name.trim() || name.length > 60) throw new Error("skin.json: name must be 1–60 chars");
  const version = str("version", true)!;
  const kind = str("kind", true)!;
  if (kind !== "skin") {
    throw new Error(`skin.json: kind "${kind}" is not "skin" (a view is a theme.json, a plugin a plugin.json)`);
  }
  const api = m.api;
  if (!Number.isInteger(api) || (api as number) < 1) throw new Error('skin.json: "api" must be a positive integer');
  if ((api as number) > SKIN_API_VERSION) {
    throw new Error(`skin.json: api ${api} is newer than this host's ${SKIN_API_VERSION}`);
  }
  const scheme = str("scheme", true)!;
  if (scheme !== "dark" && scheme !== "light" && scheme !== "both") {
    throw new Error(`skin.json: scheme "${scheme}" must be "dark", "light" or "both"`);
  }

  const out: SkinManifest = { id, name: name.trim(), version, kind: "skin", api: api as number, scheme, tokens: {} };
  const description = str("description", false);
  if (description !== undefined) out.description = description;

  // Tokens: flat for one scheme, { dark, light } for both. The shape must match the scheme.
  const t = m.tokens;
  if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error('skin.json: "tokens" must be an object');
  const tr = t as Record<string, unknown>;
  const split = "dark" in tr || "light" in tr;
  if (scheme === "both") {
    if (!split) throw new Error('skin.json: scheme "both" needs tokens.dark and tokens.light');
    for (const s of ["dark", "light"] as const) {
      if (!tr[s] || typeof tr[s] !== "object" || Array.isArray(tr[s]))
        throw new Error(`skin.json: tokens.${s} must be an object (scheme "both")`);
    }
    out.tokens = { dark: validateTokens(tr.dark, "tokens.dark"), light: validateTokens(tr.light, "tokens.light") };
  } else {
    if (split) throw new Error(`skin.json: scheme "${scheme}" takes a flat tokens map, not tokens.dark / tokens.light`);
    out.tokens = validateTokens(tr, "tokens");
  }

  if (m.fonts !== undefined) out.fonts = validateFonts(m.fonts, dir);
  if (m.typography !== undefined) out.typography = validateTypography(m.typography);
  if (m.shape !== undefined) out.shape = validateShape(m.shape);
  for (const [k, re, what] of [
    ["css", /\.css$/i, "a .css file"],
    ["preview", IMAGE_EXT, "an image (png, jpg, webp, svg)"],
  ] as const) {
    const v = str(k, false);
    if (v === undefined) continue;
    if (!isRelativeFile(v)) throw new Error(`skin.json: ${k} "${v}" must be a relative path inside the skin`);
    if (!re.test(v)) throw new Error(`skin.json: ${k} "${v}" must be ${what}`);
    if (dir && !existsSync(path.join(dir, v))) throw new Error(`${k} "${v}" is missing`);
    out[k] = v;
  }
  const source = str("source", false);
  if (source !== undefined) out.source = source;
  return out;
}

function validateTokens(raw: unknown, where: string): SkinTokens {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`skin.json: ${where} must be an object`);
  const out: SkinTokens = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const colour = (COLOR_TOKEN_NAMES as readonly string[]).includes(k);
    const style = (SKIN_STYLE_TOKEN_NAMES as readonly string[]).includes(k);
    if (!colour && !style) throw new Error(`skin.json: ${where}: unknown token ${k}`);
    if (typeof v !== "string" || !(colour ? COLOR_TOKEN_VALUE : STYLE_VALUE).test(v)) {
      throw new Error(`skin.json: ${where}: ${k} must be a CSS ${colour ? "colour" : "style"} value`);
    }
    out[k as keyof SkinTokens] = v.trim();
  }
  return out;
}

function validateFonts(raw: unknown, dir?: string): SkinFont[] {
  if (!Array.isArray(raw)) throw new Error('skin.json: "fonts" must be an array');
  return raw.map((f, i) => {
    if (!f || typeof f !== "object") throw new Error(`skin.json: fonts[${i}] must be an object`);
    const r = f as Record<string, unknown>;
    if (typeof r.family !== "string" || !r.family.trim() || !STYLE_VALUE.test(r.family))
      throw new Error(`skin.json: fonts[${i}].family must be a font family name`);
    if (typeof r.src !== "string" || !isRelativeFile(r.src))
      throw new Error(`skin.json: fonts[${i}].src must be a relative path inside the skin`);
    if (!FONT_EXT.test(r.src)) throw new Error(`skin.json: fonts[${i}].src "${r.src}" must be woff2, woff, ttf or otf`);
    if (dir && !existsSync(path.join(dir, r.src))) throw new Error(`font "${r.src}" is missing`);
    const out: SkinFont = { family: r.family.trim(), src: r.src };
    if (r.weight !== undefined) {
      const w = typeof r.weight === "number" ? String(r.weight) : r.weight;
      if (typeof w !== "string" || !/^[1-9]\d{2}( [1-9]\d{2})?$/.test(w))
        throw new Error(`skin.json: fonts[${i}].weight must be "400", "600" or a range like "200 900"`);
      out.weight = w;
    }
    if (r.style !== undefined) {
      if (r.style !== "normal" && r.style !== "italic" && r.style !== "oblique")
        throw new Error(`skin.json: fonts[${i}].style must be "normal", "italic" or "oblique"`);
      out.style = r.style;
    }
    return out;
  });
}

function validateTypography(raw: unknown): SkinTypography {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error('skin.json: "typography" must be an object');
  const r = raw as Record<string, unknown>;
  const out: SkinTypography = {};
  for (const k of ["ui", "mono"] as const) {
    if (r[k] === undefined) continue;
    if (typeof r[k] !== "string" || !STYLE_VALUE.test(r[k] as string))
      throw new Error(`skin.json: typography.${k} must be a font-family stack`);
    out[k] = (r[k] as string).trim();
  }
  if (r.scale !== undefined) {
    if (typeof r.scale !== "number" || !(r.scale >= SKIN_SCALE_MIN && r.scale <= SKIN_SCALE_MAX))
      throw new Error(`skin.json: typography.scale must be a number ${SKIN_SCALE_MIN}–${SKIN_SCALE_MAX}`);
    out.scale = r.scale;
  }
  return out;
}

function validateShape(raw: unknown): SkinShape {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error('skin.json: "shape" must be an object');
  const r = raw as Record<string, unknown>;
  const out: SkinShape = {};
  if (r.radius !== undefined) {
    if (typeof r.radius !== "number" || !(r.radius >= 0 && r.radius <= SKIN_RADIUS_MAX))
      throw new Error(`skin.json: shape.radius must be a number of px, 0–${SKIN_RADIUS_MAX}`);
    out.radius = r.radius;
  }
  if (r.hairline !== undefined) {
    if (!(SKIN_HAIRLINES as readonly unknown[]).includes(r.hairline))
      throw new Error(`skin.json: shape.hairline must be one of ${SKIN_HAIRLINES.join(", ")}`);
    out.hairline = r.hairline as SkinHairline;
  }
  if (r.density !== undefined) {
    if (!(SKIN_DENSITIES as readonly unknown[]).includes(r.density))
      throw new Error(`skin.json: shape.density must be one of ${SKIN_DENSITIES.join(", ")}`);
    out.density = r.density as SkinDensity;
  }
  return out;
}

/** A validated manifest as the list carries it: tokens per scheme, the files' base URL. */
export function skinFromManifest(m: SkinManifest, dir: string): SkinEntry {
  const tokens =
    m.scheme === "both"
      ? (m.tokens as { dark: SkinTokens; light: SkinTokens })
      : { [m.scheme]: m.tokens as SkinTokens };
  const out: SkinEntry = {
    id: m.id,
    name: m.name,
    version: m.version,
    scheme: m.scheme,
    source: "skin",
    tokens,
    url: `${SKIN_ROUTES.files}/${m.id}/`,
    dir,
  };
  if (m.description !== undefined) out.description = m.description;
  if (m.fonts) out.fonts = m.fonts;
  if (m.typography) out.typography = m.typography;
  if (m.shape) out.shape = m.shape;
  if (m.css) out.css = m.css;
  if (m.preview) out.preview = m.preview;
  if (m.source) out.origin = m.source;
  return out;
}

export interface SkinRegistryOptions {
  /** dist/bundled/skins: the skins that ship with the GUI; default `bundledDir("skin")`. */
  bundledDir?: string;
  /** The ids turned off (config.json `disabled`, as `skin:<id>`); read on every scan. */
  disabled?: () => readonly string[];
}

export class SkinRegistry {
  private entries: SkinEntry[] = [];
  readonly bundledDir: string;
  private readonly disabled: () => readonly string[];

  constructor(
    readonly skinsDir: string,
    /** <stateDir>/color-themes: the plain JSON files, listed as token-only skins. */
    readonly colorThemesDir?: string,
    opts: SkinRegistryOptions = {},
  ) {
    this.bundledDir = opts.bundledDir ?? bundledDir("skin");
    this.disabled = opts.disabled ?? (() => []);
    this.scan();
  }

  /** Re-read every folder. Never throws: a missing dir is empty. Built-ins first, then the
   *  installed packages, then the bundled ones the person has not overridden, then the
   *  color-theme files; an id taken by a package wins. */
  scan(): SkinEntry[] {
    const next: SkinEntry[] = BUILTIN_SKINS.map((b) => ({ ...b }));
    const taken = new Set(next.map((s) => s.id));
    const off = new Set(this.disabled().map((k) => k.replace(/^skin:/, "")));
    const add = (f: ScannedFolder<SkinManifest>, bundled: boolean) => {
      if (bundled && taken.has(f.id)) return;
      const entry: SkinEntry = f.manifest
        ? skinFromManifest(f.manifest, f.dir)
        : {
            id: f.id,
            name: f.id,
            version: "",
            scheme: "both",
            source: "skin",
            tokens: {},
            url: `${SKIN_ROUTES.files}/${f.id}/`,
            dir: f.dir,
            error: f.error ?? "unreadable",
          };
      if (f.linked) entry.linked = true;
      if (bundled) {
        entry.bundled = true;
        entry.origin = "bundled";
      }
      if (off.has(f.id)) entry.disabled = true;
      next.push(entry);
      taken.add(f.id);
    };
    for (const f of scanKind(skinKind(this.skinsDir))) add(f, false);
    for (const f of scanKind(skinKind(this.bundledDir))) add(f, true);
    if (this.colorThemesDir) {
      const read = readColorThemes(this.colorThemesDir);
      for (const t of read.themes) {
        const entry: SkinEntry = {
          id: t.id,
          name: t.name,
          version: "",
          scheme: t.scheme,
          source: "color-theme",
          tokens: { [t.scheme]: t.tokens },
          origin: `${t.id}.json`,
        };
        if (taken.has(t.id)) entry.error = `the id "${t.id}" is taken by an installed skin`;
        next.push(entry);
      }
      for (const e of read.errors) {
        next.push({
          id: e.file.replace(/\.json$/, ""),
          name: e.file,
          version: "",
          scheme: "both",
          source: "color-theme",
          tokens: {},
          origin: e.file,
          error: e.error,
        });
      }
    }
    for (const e of next) {
      if (e.error) continue;
      const w = contrastWarning(e);
      if (w) e.warning = w;
    }
    this.entries = next;
    return this.list();
  }

  list(): SkinEntry[] {
    return [...this.entries];
  }

  /** An installed package that can serve files (no error, not disabled) by id. */
  get(id: string): SkinEntry | undefined {
    const s = this.entries.find((e) => e.id === id && e.source === "skin");
    return s && !s.error && !s.disabled && s.dir ? s : undefined;
  }

  /** A bundled skin by id, whether or not an install overrides it. */
  isBundled(id: string): boolean {
    return existsSync(path.join(this.bundledDir, id, "skin.json"));
  }

  has(id: string): boolean {
    return this.entries.some((e) => e.id === id);
  }
}

/** The contrast shortfalls of a skin's text tiers, one line, or undefined when all clear.
 *  A "both" skin names the scheme; a single-scheme one need not. */
export function contrastWarning(skin: Pick<InstalledSkin, "scheme" | "tokens">): string | undefined {
  const parts: string[] = [];
  for (const scheme of ["dark", "light"] as const) {
    const t = skin.tokens[scheme];
    if (!t) continue;
    const w = textTierWarnings(t, scheme);
    if (w.length) parts.push(skin.scheme === "both" ? `${scheme}: ${w.join(" · ")}` : w.join(" · "));
  }
  return parts.length ? `low contrast: ${parts.join("; ")}` : undefined;
}

/** The listing as the UI API sends it: `dir` only to this machine. */
export function publicSkin(s: SkinEntry, loopback: boolean): InstalledSkin {
  if (loopback) return s;
  const { dir: _dir, ...rest } = s;
  return rest;
}
