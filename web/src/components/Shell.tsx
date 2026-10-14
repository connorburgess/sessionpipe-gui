// SPDX-License-Identifier: Apache-2.0
// The frame: a slim rail on wide screens, a bottom tab bar on phones. Carries the
// connection indicator and the theme switch.
import type { ReactNode } from "react";
import { useAppState } from "../data/hooks";
import { useGlobalKeys } from "../lib/keys";
import { Link, type Route } from "../lib/router";
import { cycleTheme, type Theme, useTheme } from "../lib/theme";
import { useNow } from "../lib/time";

const NAV: { to: string; name: Route["name"]; label: string; glyph: string }[] = [
  { to: "/", name: "board", label: "Board", glyph: "▦" },
  { to: "/feed", name: "feed", label: "Feed", glyph: "≡" },
  { to: "/machines", name: "machines", label: "Machines", glyph: "◫" },
  { to: "/connect", name: "connect", label: "Connect", glyph: "⌘" },
];

const THEME_LABEL: Record<Theme, string> = { auto: "Theme: system", dark: "Theme: dark", light: "Theme: light" };
const THEME_GLYPH: Record<Theme, string> = { auto: "◐", dark: "●", light: "○" };

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  useGlobalKeys();
  const active = route.name === "session" ? "board" : route.name;
  const needs = [...useAppState().sessions.values()].filter((s) => s.state === "needs_you" && !s.parentId).length;
  const theme = useTheme();
  const links = NAV.map((n) => (
    <Link
      key={n.to}
      to={n.to}
      className={`nav-link ${active === n.name ? "nav-link--on" : ""}`}
      aria-current={active === n.name ? "page" : undefined}
    >
      <span className="nav-glyph" aria-hidden="true">
        {n.glyph}
      </span>
      <span className="nav-label">{n.label}</span>
      {n.name === "board" && needs > 0 ? (
        <span className="nav-badge num" role="img" aria-label={`${needs} need you`}>
          {needs}
        </span>
      ) : null}
    </Link>
  ));
  return (
    <div className="shell">
      <nav className="rail" aria-label="Pages">
        <Link to="/" className="rail-brand" title="sessionpipe">
          <span className="rail-mark" aria-hidden="true" />
          <span className="sr-only">sessionpipe</span>
        </Link>
        <div className="rail-nav">{links}</div>
        <div className="rail-foot">
          <ConnectionPill />
          <button
            type="button"
            className="theme-btn"
            onClick={cycleTheme}
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
          >
            <span aria-hidden="true">{THEME_GLYPH[theme]}</span>
          </button>
        </div>
      </nav>
      <main className="main" id="main">
        {children}
      </main>
      <nav className="tabbar" aria-label="Pages">
        {links}
      </nav>
    </div>
  );
}

export function ConnectionPill() {
  const { connection, retryAt } = useAppState();
  const now = useNow();
  const wait = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const label =
    connection === "live"
      ? "live"
      : connection === "connecting"
        ? "connecting"
        : connection === "offline"
          ? "offline"
          : `retry in ${wait} s`;
  return (
    <span className={`conn conn--${connection}`} role="status" aria-live="polite" title={`Stream: ${label}`}>
      <span className="conn-dot" aria-hidden="true" />
      <span className="conn-label">{label}</span>
    </span>
  );
}
