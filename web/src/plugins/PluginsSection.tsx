// SPDX-License-Identifier: Apache-2.0
// The Plugins section of the Views page: what server plugins are installed, their
// status or error, a settings form made from each manifest (secrets as password fields
// showing the mask; saving works from the receiver machine only), Reload, and the line
// that installs more. A plugin is code running in the receiver process: the section says so.
import type { InstalledPlugin, SettingField } from "@shared/plugin-api";
import { isMasked } from "@shared/plugin-api";
import { useEffect, useState } from "react";
import { CopyButton } from "../components/bits";
import { Select } from "../components/Select";
import { fetchPlugins, reloadPlugins, savePluginSettings, usePlugins } from "./registry";
import "./plugins.css";

export const PLUGIN_ADD_LINE = "sessionpipe-gui plugin add <folder | plugin.tgz | npm-package | git-url>";

export const isLoopbackPage = (): boolean =>
  typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

export function PluginsSection() {
  const { plugins, loaded, error } = usePlugins();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const loopback = isLoopbackPage();

  useEffect(() => {
    void fetchPlugins();
  }, []);

  const reload = async () => {
    setBusy(true);
    setNote(null);
    try {
      await reloadPlugins();
      setNote("Reloaded: every plugin was stopped, re-read and started again.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sect plugins" data-plugins>
      <header className="sect-head">
        <h2>Plugins</h2>
        <p>
          Server-side code that reacts to events: a message to your phone when a session needs you, a suggested answer
          you confirm with one tap. A plugin runs inside the receiver process, with everything this machine has. Nothing
          it does can answer a permission: only your passkey signs that.
        </p>
      </header>
      {error && <p className="page-note is-err">{error}</p>}
      {loaded && plugins.length === 0 && !error && (
        <p className="themes-empty">No plugins installed. Add one with the command below.</p>
      )}
      {plugins.length > 0 && (
        <ul className="themes-list">
          {plugins.map((p) => (
            <PluginRow key={p.id} plugin={p} loopback={loopback} />
          ))}
        </ul>
      )}
      <div className="themes-tools">
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => void reload()}
          disabled={!loopback || busy}
          title={loopback ? "Stop, re-read and start every plugin" : "Only from the machine running the receiver"}
          data-plugins-reload
        >
          {busy ? "Reloading…" : "Reload plugins"}
        </button>
        {note && <span className="sect-note">{note}</span>}
        {!loopback && <span className="sect-note">Reload and settings work on the receiver machine only.</span>}
      </div>
      <div className="cmd">
        <pre className="cmd-text">
          <code>{PLUGIN_ADD_LINE}</code>
        </pre>
        <CopyButton text="sessionpipe-gui plugin add " label="Copy command" />
      </div>
      <p className="sect-note">
        Also <code>plugin link &lt;folder&gt;</code>, <code>plugin remove &lt;id&gt;</code>, <code>plugin list</code>.
        Then Reload. How to write one: <code>docs/plugin-authoring.md</code> in the repository. Only install plugins you
        trust, from people you trust.
      </p>
    </section>
  );
}

function PluginRow({ plugin: p, loopback }: { plugin: InstalledPlugin; loopback: boolean }) {
  return (
    <li className="themes-row plug-row" data-plugin-row={p.id} data-plugin-status={p.status}>
      <div className="themes-row-head">
        <span className="themes-row-name">{p.name || p.id}</span>
        {p.version && <span className="themes-row-ver">{p.version}</span>}
        <span className="themes-row-id">{p.id}</span>
        <span className={`themes-flag plug-status plug-status--${p.status}`}>{p.status}</span>
        {p.linked && <span className="themes-flag">linked</span>}
      </div>
      <div className="themes-row-meta">
        {p.description && <span>{p.description} · </span>}
        source <code>{p.source ?? "unknown"}</code>
        {p.dir && (
          <>
            {" "}
            · <code>{p.dir}</code>
          </>
        )}
      </div>
      {p.error && <div className="themes-row-err">{p.error}</div>}
      {p.settings && p.settings.length > 0 && <SettingsForm plugin={p} loopback={loopback} />}
    </li>
  );
}

function SettingsForm({ plugin: p, loopback }: { plugin: InstalledPlugin; loopback: boolean }) {
  const fields = p.settings ?? [];
  const current = p.values ?? {};
  const [draft, setDraft] = useState<Record<string, unknown>>(current);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; err?: boolean } | null>(null);
  const currentJson = JSON.stringify(current);
  // New values from the server (a save, a reload) replace what is shown.
  useEffect(() => {
    setDraft(current);
  }, [currentJson]);
  const dirty = JSON.stringify(draft) !== currentJson;

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      // Only what changed goes; a secret still showing its mask is left alone by the server.
      const patch: Record<string, unknown> = {};
      for (const f of fields) {
        if (JSON.stringify(draft[f.key]) !== JSON.stringify(current[f.key])) patch[f.key] = draft[f.key] ?? null;
      }
      await savePluginSettings(p.id, patch);
      setNote({ text: "Saved." });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), err: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="plug-form"
      data-plugin-settings={p.id}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {fields.map((f) => (
        <Field
          key={f.key}
          field={f}
          value={draft[f.key]}
          disabled={!loopback}
          onChange={(v) =>
            setDraft((d) => ({
              // A secret field typed empty again means "leave it": the stored one stays.
              ...d,
              [f.key]: f.type === "secret" && v === "" && isMasked(current[f.key]) ? current[f.key] : v,
            }))
          }
        />
      ))}
      <div className="plug-form-foot">
        <button
          type="submit"
          className={`btn btn--sm ${dirty && loopback ? "btn--primary" : "btn--ghost"}`}
          disabled={!loopback || !dirty || saving}
          title={loopback ? undefined : "Settings are saved from the receiver machine only"}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {dirty && loopback && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setDraft(current)}>
            Reset
          </button>
        )}
        {note && <span className={`sect-note ${note.err ? "is-err" : ""}`}>{note.text}</span>}
      </div>
    </form>
  );
}

function Field({
  field: f,
  value,
  disabled,
  onChange,
}: {
  field: SettingField;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `plug-${f.key}`;
  const help = f.help ? <span className="plug-help">{f.help}</span> : null;
  switch (f.type) {
    case "boolean":
      return (
        <label className="plug-field plug-field--check" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="plug-label">{f.label}</span>
          {help}
        </label>
      );
    case "multiselect": {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="plug-field plug-field--multi" disabled={disabled}>
          <legend className="plug-label">{f.label}</legend>
          <div className="plug-options">
            {(f.options ?? []).map((o) => (
              <label key={o} className="plug-option">
                <input
                  type="checkbox"
                  checked={chosen.includes(o)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...chosen.filter((c) => c !== o), o] : chosen.filter((c) => c !== o))
                  }
                />
                <code>{o}</code>
              </label>
            ))}
          </div>
          {help}
        </fieldset>
      );
    }
    case "select":
      return (
        <label className="plug-field" htmlFor={id}>
          <span className="plug-label">{f.label}</span>
          <Select<string>
            id={id}
            value={typeof value === "string" ? value : ""}
            disabled={disabled}
            onChange={onChange}
            options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
          />
          {help}
        </label>
      );
    case "number":
      return (
        <label className="plug-field" htmlFor={id}>
          <span className="plug-label">{f.label}</span>
          <input
            id={id}
            type="number"
            value={typeof value === "number" ? value : ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
          {help}
        </label>
      );
    case "secret": {
      // The stored secret is never sent to the page: the mask ("••••" + last 4) stands in as
      // the placeholder, and the field itself is empty until a new value is typed. Sending
      // the mask back (or nothing) leaves the stored secret as it is; "" removes it.
      const stored = isMasked(value);
      return (
        <label className="plug-field" htmlFor={id}>
          <span className="plug-label">{f.label}</span>
          <span className="plug-secret">
            <input
              id={id}
              type="password"
              autoComplete="off"
              value={stored ? "" : typeof value === "string" ? value : ""}
              placeholder={stored ? String(value) : "not set"}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              data-secret
            />
            {stored && !disabled && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => onChange(null)}
                title="Remove the stored value"
              >
                Remove
              </button>
            )}
          </span>
          {help}
          {stored && <span className="plug-help">Stored; shown masked. Type to replace it.</span>}
        </label>
      );
    }
    default:
      return (
        <label className="plug-field" htmlFor={id}>
          <span className="plug-label">{f.label}</span>
          <input
            id={id}
            type="text"
            value={typeof value === "string" ? value : ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </label>
      );
  }
}
