// SPDX-License-Identifier: Apache-2.0
// /themes: what is installed, where it came from, a reload for this machine, the one
// line that installs more, and the warning that a theme is code running in this page.
import { useEffect, useState } from "react";
import { CopyButton } from "../components/bits";
import { Link } from "../lib/router";
import { PluginsSection } from "../plugins/PluginsSection";
import { fetchThemes, reloadThemes, useThemes } from "../themes/host/registry";
import "../themes/host/host.css";

export const ADD_LINE = "sessionpipe-gui view add <folder | view.tgz | view.zip | npm-package | git-url>";

export function Themes() {
  const { themes, loaded, error } = useThemes();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  useEffect(() => {
    void fetchThemes();
  }, []);

  const reload = async () => {
    setBusy(true);
    setNote(null);
    try {
      await reloadThemes();
      setNote("Re-read the themes folder.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page themes">
      <section className="sect">
        <header className="sect-head">
          <h2>Installed views</h2>
          <p>Theme plugins: each one is a page of its own, listed on the rail. Files live under the state dir.</p>
        </header>
        {error && <p className="page-note is-err">{error}</p>}
        {loaded && themes.length === 0 && !error && (
          <p className="themes-empty">No views installed. Add one with the command below.</p>
        )}
        {themes.length > 0 && (
          <ul className="themes-list">
            {themes.map((t) => (
              <li key={t.id} className="themes-row" data-theme-row={t.id}>
                <div className="themes-row-head">
                  <span className="themes-row-name">{t.name || t.id}</span>
                  {t.version && <span className="themes-row-ver">{t.version}</span>}
                  <span className="themes-row-id">/t/{t.id}</span>
                  {t.linked && <span className="themes-flag">linked</span>}
                  {t.experimental && <span className="themes-flag">experimental</span>}
                  {t.error && <span className="themes-flag themes-flag--err">broken</span>}
                </div>
                <div className="themes-row-open">
                  {!t.error && (
                    <Link to={`/t/${encodeURIComponent(t.id)}`} className="btn btn--sm btn--ghost">
                      Open
                    </Link>
                  )}
                </div>
                <div className="themes-row-meta">
                  {t.description && <span>{t.description} · </span>}
                  source <code>{t.source ?? "unknown"}</code>
                  {t.dir && (
                    <>
                      {" "}
                      · <code>{t.dir}</code>
                    </>
                  )}
                </div>
                {t.error && <div className="themes-row-err">{t.error}</div>}
              </li>
            ))}
          </ul>
        )}
        <div className="themes-tools">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => void reload()}
            disabled={!loopback || busy}
            title={loopback ? "Re-read the themes folder" : "Only from the machine running the receiver"}
          >
            {busy ? "Reloading…" : "Reload"}
          </button>
          {note && <span className="sect-note">{note}</span>}
          {!loopback && <span className="sect-note">Reload works on the receiver machine only.</span>}
        </div>
      </section>

      <section className="sect">
        <header className="sect-head">
          <h2>Add a view</h2>
          <p>On the receiver machine, then Reload (or restart). A folder is copied; a link follows your edits.</p>
        </header>
        <div className="cmd">
          <pre className="cmd-text">
            <code>{ADD_LINE}</code>
          </pre>
          <CopyButton text="sessionpipe-gui view add " label="Copy command" />
        </div>
        <p className="sect-note">
          Also <code>view link &lt;folder&gt;</code>, <code>view remove &lt;id&gt;</code>, <code>view list</code> (
          <code>theme</code> is an alias). How to write one: <code>docs/theme-authoring.md</code> in the repository.
        </p>
      </section>

      <PluginsSection />

      <section className="sect">
        <header className="sect-head">
          <h2>Trust</h2>
        </header>
        <p className="themes-trust">
          A theme is code that runs in this page, with everything the page has: every session, every event, the session
          detail with tool input and output, and the ability to forget sessions. It is served from your own state dir
          and never fetched from anywhere else, but nothing sandboxes it once it runs. Only install themes you trust,
          from people you trust.
        </p>
      </section>
    </div>
  );
}
