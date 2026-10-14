// SPDX-License-Identifier: Apache-2.0
// Quick settings: one tap from the rail (wide) or the tab bar (phone) to a small popover
// with the appearance, the color theme and the text size. Each choice is per device
// (web/src/lib/theme.ts). Esc closes it through the global keys (data-dismiss).
import { useEffect, useRef, useState } from "react";
import {
  BUILTIN_COLOR_THEMES,
  type ColorTheme,
  DEFAULT_COLOR_THEME,
  fetchColorThemes,
  useColorThemes,
} from "../lib/colorTheme";
import { setColorTheme, setTextSize, setTheme, TEXT_SIZES, type TextSize, type Theme, useSettings } from "../lib/theme";
import { Segmented } from "./bits";

const APPEARANCE: { value: Theme; label: string }[] = [
  { value: "auto", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const SIZE_LABEL: Record<TextSize, string> = { 0.9: "A−", 1: "A", 1.1: "A+", 1.25: "A++" };

export function QuickSettings({ placement }: { placement: "rail" | "tabbar" }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const settings = useSettings();
  const custom = useColorThemes();

  useEffect(() => {
    if (!open) return;
    void fetchColorThemes();
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

  const current = settings.colorTheme?.id ?? DEFAULT_COLOR_THEME;
  const pick = (t: ColorTheme | null) => setColorTheme(t);

  return (
    <div className={`qs qs--${placement}`} ref={wrap}>
      <button
        type="button"
        className={`theme-btn qs-trigger ${open ? "nav-link--on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Quick settings"
        title="Quick settings: appearance, color theme, text size"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg
          viewBox="0 0 20 20"
          width="16"
          height="16"
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
        {placement === "tabbar" && <span className="nav-label">Display</span>}
      </button>
      {open && (
        <div className="qs-pop" role="dialog" aria-label="Quick settings">
          <div className="qs-row">
            <span className="qs-label">Appearance</span>
            <Segmented<Theme>
              value={settings.colorTheme ? settings.colorTheme.scheme : settings.appearance}
              onChange={setTheme}
              label="Appearance"
              options={APPEARANCE.map((o) => ({
                ...o,
                title: settings.colorTheme ? `Set by the ${settings.colorTheme.name} color theme` : undefined,
              }))}
              disabled={!!settings.colorTheme}
            />
          </div>
          <div className="qs-row">
            <span className="qs-label">Color theme</span>
            <ul className="qs-themes" aria-label="Color theme">
              <ThemeRow
                id={DEFAULT_COLOR_THEME}
                name="Default"
                hint="follows the appearance"
                on={current === DEFAULT_COLOR_THEME}
                onPick={() => pick(null)}
              />
              {BUILTIN_COLOR_THEMES.map((t) => (
                <ThemeRow
                  key={t.id}
                  id={t.id}
                  name={t.name}
                  hint={t.scheme}
                  swatch={t}
                  on={current === t.id}
                  onPick={() => pick(t)}
                />
              ))}
              {custom.themes.length > 0 && <li className="qs-divider">custom</li>}
              {custom.themes.map((t) => (
                <ThemeRow
                  key={t.id}
                  id={t.id}
                  name={t.name}
                  hint={t.scheme}
                  swatch={t}
                  on={current === t.id}
                  onPick={() => pick(t)}
                />
              ))}
            </ul>
            {custom.errors.length > 0 && (
              <p className="qs-note is-err">{custom.errors.map((e) => `${e.file}: ${e.error}`).join(" · ")}</p>
            )}
            <p className="qs-note">
              Custom: JSON files in <code>color-themes/</code> under the state dir.
            </p>
          </div>
          <div className="qs-row">
            <span className="qs-label">Text size</span>
            <Segmented<TextSize>
              value={settings.textSize}
              onChange={setTextSize}
              label="Text size"
              options={TEXT_SIZES.map((s) => ({ value: s, label: SIZE_LABEL[s], title: `${Math.round(s * 100)} %` }))}
            />
          </div>
          <button type="button" className="btn btn--sm btn--ghost qs-close" onClick={() => setOpen(false)} data-dismiss>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function ThemeRow({
  id,
  name,
  hint,
  swatch,
  on,
  onPick,
}: {
  id: string;
  name: string;
  hint: string;
  swatch?: ColorTheme;
  on: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`qs-theme ${on ? "qs-theme--on" : ""}`}
        onClick={onPick}
        aria-pressed={on}
        data-color-theme={id}
      >
        <span
          className="qs-swatch"
          aria-hidden="true"
          style={
            swatch
              ? {
                  background: swatch.tokens["--bg"],
                  borderColor: swatch.tokens["--line-2"] ?? swatch.tokens["--fg-4"],
                  color: swatch.tokens["--fg"],
                }
              : undefined
          }
        >
          Aa
          <i style={swatch ? { background: swatch.tokens["--needs"] } : undefined} />
        </span>
        <span className="qs-theme-name">{name}</span>
        <span className="qs-theme-hint">{hint}</span>
      </button>
    </li>
  );
}
