// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. The installed plugins: one folder per plugin under
// <stateDir>/plugins/<id>/ with a plugin.json (PluginManifest) and the entry module the
// host imports. Scanned at boot and on POST /api/ui/plugins/reload. A folder whose
// manifest is wrong is still listed, with `error`, so the problem shows. The folder
// layout, the scan and the installer are shared with views (server/extensions).
import { existsSync } from "node:fs";
import path from "node:path";
import {
  PLUGIN_API_VERSION,
  PLUGIN_ID_RE,
  type PluginManifest,
  type SettingField,
  type SettingType,
} from "../../shared/plugin-api.js";
import { type ExtensionKind, isRelativeFile, readManifestOf, scanKind } from "../extensions/kind.js";

/** Everything the registry knows about one folder; the host adds the running status. */
export interface PluginEntry {
  id: string;
  dir: string;
  linked?: boolean;
  manifest?: PluginManifest;
  error?: string;
}

const SETTING_TYPES: SettingType[] = ["string", "secret", "number", "boolean", "select", "multiselect"];

/** The plugin kind, for the shared installer and scan: plugin.json under `dir`. */
export function pluginKind(dir: string): ExtensionKind<PluginManifest> {
  return { kind: "plugin", noun: "plugin", manifestFile: "plugin.json", dir, validate: validatePluginManifest };
}

/** Read and validate a plugin.json; throws with a message for the person. */
export function readPluginManifest(dir: string): PluginManifest {
  return readManifestOf(pluginKind(path.dirname(dir)), dir);
}

export function validatePluginManifest(raw: unknown, dir?: string): PluginManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("plugin.json must be an object");
  const m = raw as Record<string, unknown>;
  const str = (k: string, required: boolean): string | undefined => {
    const v = m[k];
    if (v === undefined || v === null) {
      if (required) throw new Error(`plugin.json: "${k}" is required`);
      return undefined;
    }
    if (typeof v !== "string") throw new Error(`plugin.json: "${k}" must be a string`);
    return v;
  };
  const id = str("id", true)!;
  if (!PLUGIN_ID_RE.test(id)) throw new Error(`plugin.json: id "${id}" must match ${PLUGIN_ID_RE}`);
  const name = str("name", true)!;
  const version = str("version", true)!;
  const kind = str("kind", true)!;
  if (kind !== "plugin") {
    throw new Error(`plugin.json: kind "${kind}" is not "plugin" (a view is a theme.json, a skin a skin.json)`);
  }
  const api = m.api;
  if (!Number.isInteger(api) || (api as number) < 1) throw new Error('plugin.json: "api" must be a positive integer');
  if ((api as number) > PLUGIN_API_VERSION) {
    throw new Error(`plugin.json: api ${api} is newer than this host's ${PLUGIN_API_VERSION}`);
  }
  const entry = str("entry", false) ?? "index.js";
  if (!isRelativeFile(entry))
    throw new Error(`plugin.json: entry "${entry}" must be a relative path inside the plugin`);
  if (dir && !existsSync(path.join(dir, entry))) throw new Error(`entry "${entry}" is missing`);
  const out: PluginManifest = { id, name, version, kind: "plugin", entry, api: api as number };
  const description = str("description", false);
  if (description !== undefined) out.description = description;
  const source = str("source", false);
  if (source !== undefined) out.source = source;
  if (m.settings !== undefined) out.settings = validateSettings(m.settings);
  return out;
}

function validateSettings(raw: unknown): SettingField[] {
  if (!Array.isArray(raw)) throw new Error('plugin.json: "settings" must be an array');
  const keys = new Set<string>();
  return raw.map((f, i) => {
    if (!f || typeof f !== "object") throw new Error(`plugin.json: settings[${i}] must be an object`);
    const r = f as Record<string, unknown>;
    if (typeof r.key !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(r.key)) {
      throw new Error(`plugin.json: settings[${i}].key must be an identifier`);
    }
    if (keys.has(r.key)) throw new Error(`plugin.json: setting "${r.key}" is listed twice`);
    keys.add(r.key);
    if (typeof r.label !== "string" || !r.label) throw new Error(`plugin.json: setting "${r.key}" needs a label`);
    if (!SETTING_TYPES.includes(r.type as SettingType)) {
      throw new Error(`plugin.json: setting "${r.key}" has an unknown type "${String(r.type)}"`);
    }
    const out: SettingField = { key: r.key, label: r.label, type: r.type as SettingType };
    if (r.type === "select" || r.type === "multiselect") {
      if (!Array.isArray(r.options) || !r.options.length || !r.options.every((o) => typeof o === "string")) {
        throw new Error(`plugin.json: setting "${r.key}" needs "options": a list of strings`);
      }
      out.options = r.options as string[];
    }
    if (r.default !== undefined) {
      const problem = checkValue(out, r.default);
      if (problem) throw new Error(`plugin.json: setting "${r.key}" default ${problem}`);
      out.default = r.default;
    }
    if (r.help !== undefined) {
      if (typeof r.help !== "string") throw new Error(`plugin.json: setting "${r.key}" help must be a string`);
      out.help = r.help;
    }
    return out;
  });
}

/** Why `value` does not fit the field, or null when it does. */
export function checkValue(field: SettingField, value: unknown): string | null {
  switch (field.type) {
    case "string":
    case "secret":
      return typeof value === "string" ? null : "must be a string";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a number";
    case "boolean":
      return typeof value === "boolean" ? null : "must be true or false";
    case "select":
      return typeof value === "string" && field.options!.includes(value)
        ? null
        : `must be one of ${field.options!.join(", ")}`;
    case "multiselect":
      return Array.isArray(value) && value.every((v) => typeof v === "string" && field.options!.includes(v))
        ? null
        : `must be a list from ${field.options!.join(", ")}`;
  }
}

export class PluginRegistry {
  private entries = new Map<string, PluginEntry>();

  constructor(readonly pluginsDir: string) {
    this.scan();
  }

  /** Re-read every folder under the plugins dir. Never throws: a missing dir is empty. */
  scan(): PluginEntry[] {
    const next = new Map<string, PluginEntry>();
    for (const f of scanKind(pluginKind(this.pluginsDir))) {
      const entry: PluginEntry = { id: f.id, dir: f.dir };
      if (f.linked) entry.linked = true;
      if (f.manifest) entry.manifest = f.manifest;
      else entry.error = f.error ?? "unreadable";
      next.set(f.id, entry);
    }
    this.entries = next;
    return this.list();
  }

  list(): PluginEntry[] {
    return [...this.entries.values()];
  }

  get(id: string): PluginEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }
}
