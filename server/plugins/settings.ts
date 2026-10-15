// SPDX-License-Identifier: Apache-2.0
// Owned by: platform. A plugin's settings: one JSON document per plugin under
// <stateDir>/plugins-settings/<id>.json, mode 0600 (secrets live here). The manifest's
// `settings` describe the fields; values are checked against them on every save, and
// a secret that comes back in its masked form ("••••" + last 4) is left as it was.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMasked, type PluginManifest, withDefaults } from "../../shared/plugin-api.js";
import { checkValue } from "./registry.js";

export class SettingsError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

export class PluginSettings {
  constructor(readonly dir: string) {}

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  /** The stored values only (no defaults); {} when nothing was saved yet or the file is bad. */
  stored(id: string): Record<string, unknown> {
    try {
      const v = JSON.parse(readFileSync(this.file(id), "utf8")) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** Defaults from the manifest under the stored values: what the plugin gets. */
  get(manifest: PluginManifest): Record<string, unknown> {
    return withDefaults(manifest, this.stored(manifest.id));
  }

  /** Check `patch` against the manifest and merge it into the stored values. Unknown keys
   *  are dropped; a masked secret keeps the stored one; an empty secret clears it. Throws
   *  SettingsError naming the field on a value that does not fit. */
  save(manifest: PluginManifest, patch: Record<string, unknown>): Record<string, unknown> {
    const current = this.stored(manifest.id);
    const next = { ...current };
    for (const f of manifest.settings ?? []) {
      if (!(f.key in patch)) continue;
      const v = patch[f.key];
      if (f.type === "secret") {
        if (isMasked(v)) continue;
        if (v === "" || v === null || v === undefined) {
          delete next[f.key];
          continue;
        }
      }
      if (v === null || v === undefined) {
        delete next[f.key];
        continue;
      }
      const problem = checkValue(f, v);
      if (problem) throw new SettingsError(f.key, `${f.label} ${problem}`);
      next[f.key] = v;
    }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = this.file(manifest.id);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    return withDefaults(manifest, next);
  }
}
