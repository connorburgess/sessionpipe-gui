// SPDX-License-Identifier: Apache-2.0
// Quick settings: one tap from the rail (wide) or the tab bar (phone) to a small popover
// with the appearance, the skin and the text size. Each choice is per device
// (web/src/lib/theme.ts). Esc closes it through the global keys (data-dismiss). On a
// phone the trigger is a row in the tab bar's More sheet, which owns the open state.

import { skinTokensFor } from "@shared/skin-api";
import { useEffect, useRef, useState } from "react";
import { focusTab, tablistKey, useFocusTrap } from "../lib/focus";
import { Link, navigate } from "../lib/router";
import { fetchSkins, type InstalledSkin, isPlain, schemeLabel, useSkins } from "../lib/skins";
import {
  resolvedScheme,
  setSkin,
  setTextSize,
  setTheme,
  TEXT_SIZES,
  type TextSize,
  type Theme,
  useSettings,
} from "../lib/theme";
import { KeyboardQuick } from "../pages/Shortcuts";
import { Segmented } from "./bits";

const APPEARANCE: { value: Theme; label: string }[] = [
  { value: "auto", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const SIZE_LABEL: Record<TextSize, string> = { 0.9: "A−", 1: "A", 1.1: "A+", 1.25: "A++" };
export const SKIN_ADD_LINE = "sessionpipe-gui skin add <folder | skin.tgz | skin.zip | npm-package | git-url>";

// Settings.tsx (the Notifications section of the dialog) looks for the section under these
// names; it lives in NotificationsSettings.tsx. The popover itself is appearance only.
export { NotificationsSettings, NotificationsSettings as NotificationsSection } from "./NotificationsSettings";

export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" />
    </svg>
  );
}

export function QuickSettings({
  placement,
  trigger = true,
  open: openProp,
  onOpenChange,
}: {
  placement: "rail" | "tabbar";
  /** false: no button of its own; the caller opens it through `open`. */
  trigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const v = typeof next === "function" ? next(open) : next;
    setOpenState(v);
    onOpenChange?.(v);
  };
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"display" | "keyboard">("display");
  // Focus stays inside while open, Esc closes, and it goes back to the trigger after.
  useFocusTrap(pop, open, { onClose: () => setOpen(false) });
  const settings = useSettings();
  const { skins, error: skinsError } = useSkins();

  useEffect(() => {
    if (!open) return;
    void fetchSkins();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const current = settings.skin.id;
  const forced = settings.skin.scheme !== "both";
  const scheme = resolvedScheme(settings);
  const builtins = skins.filter((s) => s.source === "builtin");
  // A disabled skin (`sessionpipe-gui skin disable <id>`) stays out of the popover.
  const installed = skins.filter((s) => s.source !== "builtin" && !s.disabled);
  const row = (s: InstalledSkin) => (
    <SkinRow key={s.id} skin={s} scheme={scheme} on={current === s.id} onPick={() => setSkin(s)} />
  );

  return (
    <div className={`qs qs--${placement}`} ref={wrap}>
      {trigger && (
        <button
          type="button"
          className={`theme-btn qs-trigger ${open ? "nav-link--on" : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-label="Quick settings"
          data-tip="Quick settings"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <GearIcon />
        </button>
      )}
      {open && (
        <div className="qs-pop" role="dialog" aria-modal="true" aria-label="Quick settings" ref={pop}>
          <div
            className="qs-tabs"
            role="tablist"
            aria-label="Quick settings section"
            onKeyDown={(e) => {
              const tabs = ["display", "keyboard"] as const;
              tablistKey(e, tabs.length, tabs.indexOf(tab), {
                activate: (i) => {
                  setTab(tabs[i]!);
                  focusTab(e.currentTarget, i);
                },
              });
            }}
          >
            {(["display", "keyboard"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                className="qs-tab"
                aria-selected={tab === t}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
                data-qs-tab={t}
              >
                {t === "display" ? "Display" : "Keyboard"}
              </button>
            ))}
          </div>
          {tab === "keyboard" && <KeyboardQuick />}
          {tab === "display" && (
            <>
              <div className="qs-row">
                <span className="qs-label">Appearance</span>
                <Segmented<Theme>
                  value={forced ? (settings.skin.scheme as Theme) : settings.appearance}
                  onChange={setTheme}
                  label="Appearance"
                  options={APPEARANCE.map((o) => ({
                    ...o,
                    title: forced ? `Set by the ${settings.skin.name} skin` : undefined,
                  }))}
                  disabled={forced}
                />
              </div>
              <div className="qs-row">
                <span className="qs-label">Skin</span>
                <ul className="qs-themes" aria-label="Skin">
                  <li className="qs-divider">Built-in</li>
                  {builtins.map(row)}
                  {installed.length > 0 && <li className="qs-divider">Installed</li>}
                  {installed.map(row)}
                </ul>
                {skinsError && <p className="qs-note is-err">{skinsError}</p>}
                <p className="qs-note">
                  Install: <code>{SKIN_ADD_LINE}</code>; or drop a color-theme JSON into <code>color-themes/</code>{" "}
                  under the state dir.
                </p>
              </div>
              <div className="qs-row">
                <span className="qs-label">Text size</span>
                <Segmented<TextSize>
                  value={settings.textSize}
                  onChange={setTextSize}
                  label="Text size"
                  options={TEXT_SIZES.map((s) => ({
                    value: s,
                    label: SIZE_LABEL[s],
                    title: `${Math.round(s * 100)} %`,
                  }))}
                />
              </div>
            </>
          )}
          <div className="qs-foot">
            <Link
              to="/settings"
              className="qs-all"
              data-nav="all-settings"
              plainClick={() => {
                setOpen(false);
                navigate("/settings");
              }}
            >
              All settings →
            </Link>
            <button
              type="button"
              className="btn btn--sm btn--ghost qs-close"
              onClick={() => setOpen(false)}
              data-dismiss
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The five stripes of the swatch strip, from the skin's tokens for `scheme`; a token the
 *  skin does not set falls back to the page's own, so Plain shows the stock scheme. */
const STRIP: readonly ("--bg" | "--bg-2" | "--fg" | "--needs" | "--state-working")[] = [
  "--bg",
  "--bg-2",
  "--fg",
  "--needs",
  "--state-working",
];

function SkinRow({
  skin,
  scheme,
  on,
  onPick,
}: {
  skin: InstalledSkin;
  scheme: "dark" | "light";
  on: boolean;
  onPick: () => void;
}) {
  const tokens = skinTokensFor(skin, scheme);
  const hint = skin.error
    ? "broken"
    : isPlain(skin)
      ? "the stock tokens"
      : `${schemeLabel(skin.scheme)}${skin.warning ? " · low contrast" : ""}`;
  const extras = [
    skin.warning ?? "",
    skin.fonts?.length ? "fonts" : "",
    skin.css ? "css" : "",
    skin.linked ? "linked" : "",
    skin.bundled ? "bundled" : "",
  ].filter(Boolean);
  return (
    <li>
      <button
        type="button"
        className={`qs-theme ${on ? "qs-theme--on" : ""}`}
        onClick={onPick}
        aria-pressed={on}
        disabled={!!skin.error}
        title={skin.error ?? (extras.length ? extras.join(" · ") : undefined)}
        data-skin={skin.id}
        data-skin-source={skin.source}
      >
        <span className="qs-strip" aria-hidden="true">
          {STRIP.map((t) => (
            <i key={t} style={{ background: tokens[t] ?? `var(${t})` }} />
          ))}
        </span>
        <span className="qs-theme-name">{skin.name}</span>
        <span className="qs-theme-hint">{hint}</span>
      </button>
    </li>
  );
}
