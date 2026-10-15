// SPDX-License-Identifier: Apache-2.0
// The curated extras on the Views page: the official views, skins and plugins. Every one
// ships inside the GUI today, so each row says "bundled"; an entry that is not bundled
// gets an Install button that works from the receiver machine (POST
// /api/ui/extras/:id/install, loopback only) and the one line that does the same from a
// terminal anywhere.
import type { ExtraEntry, ExtrasResponse } from "@shared/api";
import { ROUTES } from "@shared/api";
import { useCallback, useEffect, useState } from "react";
import { fetchSkins } from "../lib/skins";
import { fetchPlugins } from "../plugins/registry";
import { fetchThemes } from "../themes/host/registry";
import { CopyButton } from "./bits";

export const EXTRAS_ALL_LINE = "sessionpipe-gui extras add all";

type Row = ExtrasResponse["extras"][number];

/** Re-read whatever list the kind shows up in. */
function refresh(kind: ExtraEntry["kind"]): Promise<void> {
  return kind === "view" ? fetchThemes() : kind === "skin" ? fetchSkins() : fetchPlugins();
}

export function Extras({ loopback }: { loopback: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(ROUTES.ui.extras, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setRows(((await res.json()) as ExtrasResponse).extras);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const install = async (row: Row) => {
    setBusy(row.id);
    setLog((l) => ({ ...l, [row.id]: "" }));
    try {
      const res = await fetch(`${ROUTES.ui.extras}/${encodeURIComponent(row.id)}/install`, { method: "POST" });
      const text = res.ok ? await res.text() : `${res.status} ${res.statusText}`;
      setLog((l) => ({ ...l, [row.id]: text.trim() }));
      if (res.ok && text.trimEnd().endsWith("\nok")) await refresh(row.kind);
      await load();
    } catch (e) {
      setLog((l) => ({ ...l, [row.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };
  const installAll = async () => {
    for (const row of rows ?? []) if (!row.bundled && !row.installed) await install(row);
  };

  const todo = (rows ?? []).filter((r) => !r.bundled && !r.installed);
  const installable = (rows ?? []).some((r) => !r.bundled);
  return (
    <section className="sect" data-extras>
      <header className="sect-head">
        <h2>Extras</h2>
        <p>
          The official views, skins and plugins, all inside the GUI already: Canvas and Office on the rail, Spacesheep
          Vivid and Paper Serif in the appearance popover, ping-a-human under Plugins (off until you enable it).
        </p>
      </header>
      {error && <p className="page-note is-err">{error}</p>}
      {rows && (
        <ul className="extras-list">
          {rows.map((r) => (
            <li key={r.id} className="extras-row" data-extra={r.id}>
              <div className="extras-row-head">
                <span className="extras-row-name">{r.name}</span>
                <span className="extras-row-kind">{r.kind}</span>
                <span className="extras-row-size">{r.size}</span>
                {r.bundled && <span className="themes-flag">bundled</span>}
                {!r.bundled && r.installed && <span className="themes-flag">installed</span>}
              </div>
              <div className="extras-row-act">
                {!r.bundled && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void install(r)}
                    disabled={!loopback || busy !== null}
                    title={loopback ? `npm install ${r.npm}` : "Only from the machine running the receiver"}
                    data-extra-install={r.id}
                  >
                    {busy === r.id ? "Installing…" : r.installed ? "Reinstall" : "Install"}
                  </button>
                )}
              </div>
              <div className="extras-row-meta">
                {r.line}
                {!r.bundled && (
                  <>
                    {" "}
                    <code>{r.npm}</code>
                  </>
                )}
              </div>
              {log[r.id] && (
                <pre className={`extras-log${log[r.id]?.endsWith("\nok") ? "" : " is-err"}`} data-extra-log={r.id}>
                  {log[r.id]}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
      {installable && (
        <div className="extras-tools">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void installAll()}
            disabled={!loopback || busy !== null || todo.length === 0}
            title={
              loopback ? "Install every extra that is not there yet" : "Only from the machine running the receiver"
            }
            data-extras-install-all
          >
            {todo.length === 0 ? "All installed" : `Install all (${todo.length})`}
          </button>
          <span className="sect-note">
            {loopback ? "From a terminal:" : "Buttons work on the receiver machine only. From its terminal:"}
          </span>
          <code className="extras-line">{EXTRAS_ALL_LINE}</code>
          <CopyButton text={EXTRAS_ALL_LINE} label="Copy command" />
        </div>
      )}
    </section>
  );
}
