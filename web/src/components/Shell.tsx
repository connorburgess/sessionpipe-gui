// SPDX-License-Identifier: Apache-2.0
// The frame: a slim rail on wide screens, a bottom tab bar on phones. Carries the
// connection indicator and the theme switch.
import { Fragment, type ReactNode } from "react";
import { useAppState } from "../data/hooks";
import { useGlobalKeys } from "../lib/keys";
import { Link, type Route } from "../lib/router";
import { cycleTheme, type Theme, useTheme } from "../lib/theme";
import { useNow } from "../lib/time";

/* Thin 1.5 px line icons on a 20 px grid. */
const ICON: Record<string, ReactNode> = {
  board: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </>
  ),
  feed: (
    <>
      <path d="M3 5h14" />
      <path d="M3 10h14" />
      <path d="M3 15h10" />
    </>
  ),
  machines: (
    <>
      <rect x="2.5" y="4" width="15" height="10" rx="1.5" />
      <path d="M7 17h6" />
    </>
  ),
  connect: (
    <>
      <path d="M8.5 11.5l3-3" />
      <path d="M7 13l-1.5 1.5a2.5 2.5 0 0 1-3.5-3.5L4 9" />
      <path d="M13 7l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L16 11" />
    </>
  ),
  /* A room with a door, for the experimental office view when it is wired in. */
  office: (
    <>
      <path d="M3 16.5V5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 17 5v11.5" />
      <path d="M2.5 16.5h15" />
      <path d="M7.5 16.5v-5h5v5" />
    </>
  ),
};

const NAV: { to: string; name: Route["name"]; label: string; experimental?: boolean }[] = [
  { to: "/", name: "board", label: "Board" },
  { to: "/feed", name: "feed", label: "Feed" },
  { to: "/machines", name: "machines", label: "Machines" },
  { to: "/connect", name: "connect", label: "Connect" },
  { to: "/office", name: "office", label: "Office", experimental: true },
];

const THEME_LABEL: Record<Theme, string> = { auto: "Theme: system", dark: "Theme: dark", light: "Theme: light" };

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
      <svg
        className="nav-glyph"
        viewBox="0 0 20 20"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICON[n.name]}
      </svg>
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
        <div className="rail-nav">
          {NAV.map((n, i) => (
            <Fragment key={n.to}>
              {n.experimental && !NAV[i - 1]?.experimental ? <span className="rail-group">experimental</span> : null}
              {links[i]}
            </Fragment>
          ))}
        </div>
        <div className="rail-foot">
          <ConnectionPill />
          <button
            type="button"
            className="theme-btn"
            onClick={cycleTheme}
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              {theme === "light" ? null : theme === "dark" ? (
                <circle cx="10" cy="10" r="4" fill="currentColor" />
              ) : (
                <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
              )}
            </svg>
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
