// SPDX-License-Identifier: Apache-2.0
// Settings: /settings, a centred dialog over the page (a gear in the rail's foot, a row in
// the phone's More sheet, "All settings →" at the foot of the appearance popover). A list
// of sections on the left, one pane on the right, the rows in the same language as the
// appearance popover (13 px / 500 labels, 40 px rows). Everything here is per device and
// lives in lib/settings.ts; the appearance, color theme and text size stay in the popover.
// Esc and the scrim close it; Tab stays inside.
import { type Info, ROUTES, type SessionSummary } from "@shared/api";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useAppState, useStore } from "../data/hooks";
import { bytes } from "../lib/format";
import { back, hasInAppHistory, Link, navigate, useSearchParam } from "../lib/router";
import {
  DEFAULT_PAGES,
  type DefaultPage,
  type Mode,
  type OpenSessions,
  setSettings,
  useAppSettings,
} from "../lib/settings";
import { useSkins } from "../lib/skins";
import { TIER_HINT, TIER_LABEL } from "../lib/tier";
import { KeyboardQuick } from "../pages/Shortcuts";
import { useThemes } from "../themes/host/registry";
import { CopyButton, Segmented, Toggle } from "./bits";
import { LensPicker } from "./LensChip";
import { NotificationsSettings } from "./NotificationsSettings";
import { SKIN_ADD_LINE } from "./QuickSettings";
import { Select } from "./Select";

export type Section = "general" | "lens" | "notifications" | "keyboard" | "views" | "data" | "about";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "lens", label: "Tier lens" },
  { id: "notifications", label: "Notifications" },
  { id: "keyboard", label: "Keyboard" },
  { id: "views", label: "Views, skins & plugins" },
  { id: "data", label: "Data" },
  { id: "about", label: "About" },
];
const isSection = (v: string | null): v is Section => SECTIONS.some((s) => s.id === v);

export const settingsPath = (section?: Section) => (section ? `/settings?section=${section}` : "/settings");

const FOCUSABLE =
  "a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex='-1'])";

/** The section the URL asks for: `?section=data`, or `#notifications` (a link from elsewhere). */
function useSection(): Section {
  const param = useSearchParam("section");
  const hash = location.hash.replace(/^#/, "");
  if (isSection(param)) return param;
  if (isSection(hash)) return hash;
  return "general";
}

export function Settings() {
  const section = useSection();
  const ref = useRef<HTMLDivElement>(null);
  // Back to the page under the dialog; opened by its URL, to the board (the split panel stays).
  const close = () => (hasInAppHistory() ? back("/") : navigate("/"));

  // Focus the active section's tab on open; Tab and shift+Tab cycle inside the dialog.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus();
  }, []);
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const pick = (id: Section) => navigate(settingsPath(id), { replace: true });

  return (
    <div className="settings-wrap">
      <button type="button" className="settings-scrim" aria-label="Close settings" onClick={close} data-dismiss />
      <div className="settings" role="dialog" aria-label="Settings" aria-modal="true" ref={ref} onKeyDown={onKey}>
        <nav className="settings-nav" aria-label="Settings sections">
          <h1 className="settings-title">Settings</h1>
          <div className="settings-tabs" role="tablist" aria-orientation="vertical">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                className={`settings-tab ${s.id === section ? "settings-tab--on" : ""}`}
                aria-selected={s.id === section}
                onClick={() => pick(s.id)}
                data-section={s.id}
              >
                {s.label}
              </button>
            ))}
          </div>
        </nav>
        <div className="settings-pane" role="tabpanel" aria-label={SECTIONS.find((s) => s.id === section)?.label}>
          {section === "general" && <General />}
          {section === "lens" && <Lens />}
          {section === "notifications" && <Notifications />}
          {section === "keyboard" && <Keyboard />}
          {section === "views" && <Views />}
          {section === "data" && <Data />}
          {section === "about" && <About />}
        </div>
        <button type="button" className="btn btn--sm btn--ghost settings-close" onClick={close} aria-label="Close">
          Close
        </button>
      </div>
    </div>
  );
}

/** One setting: a label, a hint under it, the control on the right. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="qs-label">{label}</span>
        {hint && <span className="settings-hint">{hint}</span>}
      </div>
      <div className="settings-row-ctl">{children}</div>
    </div>
  );
}

const MODES: { value: Mode; label: string; title: string }[] = [
  { value: "simple", label: "Simple", title: "The board, the inbox, your sessions as a chat; nothing else in the way" },
  { value: "advanced", label: "Advanced", title: "Every page, every count, the tier lens, the dense timeline" },
];

/** The one-line Simple / Advanced switch, shared with the `?` help: the row says which mode
 *  is on and what the other one adds. Simple is the default until a device chooses. */
export function ModeRow({ hint = true }: { hint?: boolean }) {
  const s = useAppSettings();
  return (
    <Row
      label={s.mode === "simple" ? "Simple mode" : "Advanced mode"}
      hint={
        hint
          ? s.mode === "simple"
            ? "Switch to Advanced for every page, the counts, the tier lens and the dense timeline."
            : "Switch to Simple for the board, the inbox and your sessions as a chat, nothing else in the way."
          : undefined
      }
    >
      <Segmented<Mode> value={s.mode} onChange={(mode) => setSettings({ mode })} label="Mode" options={MODES} />
    </Row>
  );
}

function General() {
  const s = useAppSettings();
  return (
    <>
      <ModeRow />
      <Row label="Open on" hint="The page this device lands on when it opens the app at its root.">
        <Select<DefaultPage>
          className="settings-select"
          size="sm"
          align="end"
          value={s.defaultPage}
          onChange={(defaultPage) => setSettings({ defaultPage })}
          aria-label="Default page"
          options={DEFAULT_PAGES}
        />
      </Row>
      <Row label="Confirm before Forget" hint="Forget deletes everything held for a session here. Off: one click.">
        <Toggle
          on={s.confirmForget}
          onChange={(confirmForget) => setSettings({ confirmForget })}
          label="Confirm before Forget"
        />
      </Row>
      <Row label="Open sessions" hint="A plain click on a card or a feed row. Shift-click always opens beside.">
        <Segmented<OpenSessions>
          value={s.openSessions}
          onChange={(openSessions) => setSettings({ openSessions })}
          label="Open sessions"
          options={[
            { value: "page", label: "As page" },
            { value: "beside", label: "Beside" },
          ]}
        />
      </Row>
    </>
  );
}

function Lens() {
  const s = useAppSettings();
  return (
    <>
      <Row
        label="Tier lens"
        hint={
          s.mode === "simple"
            ? "Simple mode shows everything; the lens applies in Advanced."
            : "What a receiver at this tier would have got, applied to every page: the board, the feed, the inbox, each session. Click the chip at the top right to cycle, hold it to pick, or press l."
        }
      >
        <LensPicker />
      </Row>
      <dl className="settings-tiers">
        <div>
          <dt>all</dt>
          <dd>Everything that arrived, at whatever tier each machine sends.</dd>
        </div>
        {([0, 1, 2, 3] as const).map((t) => (
          <div key={t}>
            <dt className="num">
              {t} · {TIER_LABEL[t]}
            </dt>
            <dd>{TIER_HINT[t]}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** The inbox engineer's panel: notify me, sounds, per-event alerts (components/NotificationsSettings.tsx). */
function Notifications() {
  return <NotificationsSettings />;
}

/** The keyboard engineer's quick tab (pages/Shortcuts.tsx): presets, the common keys, the link. */
function Keyboard() {
  return <KeyboardQuick />;
}

function Views() {
  const { themes } = useThemes();
  const { skins } = useSkins();
  const ok = themes.filter((t) => !t.error);
  const installedSkins = skins.filter((s) => s.source !== "builtin" && !s.error);
  const brokenSkins = skins.filter((s) => s.source !== "builtin" && s.error);
  return (
    <>
      <Row
        label="Views"
        hint={
          ok.length === 0
            ? "No view plugins installed."
            : `${ok.length} installed: ${ok.map((t) => t.name || t.id).join(", ")}.`
        }
      >
        <Link to="/themes" className="btn btn--sm">
          Manage views
        </Link>
      </Row>
      <Row
        label="Skins"
        hint={
          <>
            {installedSkins.length === 0
              ? "None installed beyond the built-ins."
              : `${installedSkins.length} installed: ${installedSkins.map((s) => s.name || s.id).join(", ")}.`}
            {brokenSkins.length > 0 && ` ${brokenSkins.length} broken (see the appearance popover).`} Pick one in the
            appearance popover (the gear on the rail). Install on the receiver machine:{" "}
            <code className="mono" data-skin-add>
              {SKIN_ADD_LINE}
            </code>
          </>
        }
      >
        <CopyButton text="sessionpipe-gui skin add " label="Copy" small />
      </Row>
      <p className="settings-hint">
        A view is code that runs in this page. Install, link for development or remove them on the Views page. A skin is
        tokens, fonts and a stylesheet: it runs no code. Plugins run in the receiver process; their settings are on the
        Views page too.
      </p>
    </>
  );
}

const AGES: { days: number; label: string }[] = [
  { days: 1, label: "a day" },
  { days: 7, label: "a week" },
  { days: 30, label: "a month" },
  { days: 90, label: "three months" },
];

function Data() {
  const store = useStore();
  const { stats, sessions } = useAppState();
  const [info, setInfo] = useState<Info | null>(null);
  const [days, setDays] = useState(30);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    store.transport
      .info()
      .then(setInfo)
      .catch(() => {});
  }, [store]);

  const cutoff = Date.now() - days * 86_400_000;
  const old: SessionSummary[] = [...sessions.values()].filter(
    (s) => s.state === "done" && Date.parse(s.lastAt) < cutoff,
  );

  const forgetOld = async () => {
    setBusy("forget");
    setNote(null);
    let n = 0;
    try {
      for (const s of old) {
        await store.transport.forget(s.harness, s.id);
        store.apply({ kind: "forgotten", key: s.key });
        n++;
      }
      setNote(`Forgot ${n} ${n === 1 ? "session" : "sessions"}.`);
    } catch (e) {
      setNote(`${n} forgotten, then: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };
  const exportSnapshot = async () => {
    setBusy("export");
    setNote(null);
    try {
      const res = await fetch(ROUTES.ui.snapshot, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sessionpipe-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Row
        label="Storage"
        hint={
          info ? (
            <span className="mono">{info.storage.dir}</span>
          ) : (
            "The events this receiver holds, one file per session."
          )
        }
      >
        <span className="num settings-value" data-storage>
          {info ? bytes(info.storage.bytes) : stats ? bytes(stats.storageBytes) : "–"}
          {stats && <small> · {stats.events.toLocaleString()} events</small>}
        </span>
      </Row>
      <Row
        label="Forget done sessions older than"
        hint={`${old.length} ${old.length === 1 ? "session matches" : "sessions match"} right now. Deletes their files here; the machines keep their own.`}
      >
        <span className="settings-inline">
          <Select<number>
            className="settings-select"
            size="sm"
            align="end"
            value={days}
            onChange={setDays}
            aria-label="Older than"
            options={AGES.map((a) => ({ value: a.days, label: a.label }))}
          />
          {confirm ? (
            <span className="confirm" role="alertdialog" aria-label="Forget these sessions?">
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => void forgetOld()}
                disabled={busy === "forget"}
              >
                {busy === "forget" ? "Forgetting…" : `Forget ${old.length}`}
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setConfirm(true)}
              disabled={old.length === 0 || !!busy}
            >
              Forget…
            </button>
          )}
        </span>
      </Row>
      <Row label="Export" hint="The current snapshot (every session summary) as JSON.">
        <button type="button" className="btn btn--sm" onClick={() => void exportSnapshot()} disabled={!!busy}>
          {busy === "export" ? "Exporting…" : "Download JSON"}
        </button>
      </Row>
      {note && <p className="settings-hint">{note}</p>}
    </>
  );
}

function About() {
  const store = useStore();
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    store.transport
      .info()
      .then(setInfo)
      .catch(() => {});
  }, [store]);
  return (
    <>
      <Row label="sessionpipe gui" hint="A sessionpipe receiver with a face: one process, no database, a live board.">
        <span className="num settings-value">{info ? info.version : "–"}</span>
      </Row>
      <ul className="settings-links">
        <li>
          <a href="https://github.com/spacesheep-dev/sessionpipe" target="_blank" rel="noreferrer noopener">
            sessionpipe on GitHub ↗
          </a>
        </li>
        <li>
          <a
            href="https://github.com/spacesheep-dev/sessionpipe/blob/main/spec/PROTOCOL.md"
            target="_blank"
            rel="noreferrer noopener"
          >
            The protocol and its tiers ↗
          </a>
        </li>
        <li>
          <Link to="/connect">Connect a machine or a phone →</Link>
        </li>
      </ul>
      <p className="settings-hint">Apache-2.0 · nothing here calls anywhere but its own origin.</p>
    </>
  );
}
