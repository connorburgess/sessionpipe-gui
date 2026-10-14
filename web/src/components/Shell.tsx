// SPDX-License-Identifier: Apache-2.0
// The frame: a slim rail on wide screens, a bottom tab bar on phones. Carries the
// connection indicator, the theme switch, and one entry per installed theme plugin
// (web/src/themes/host), routed to /t/<id>.
import type { InstalledTheme } from "@shared/theme-api";
import { Fragment, type ReactNode } from "react";
import { useAppState } from "../data/hooks";
import { useGlobalKeys } from "../lib/keys";
import { Link, type Route } from "../lib/router";
import { useNow } from "../lib/time";
import { useThemes } from "../themes/host/registry";
import { QuickSettings } from "./QuickSettings";

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
  /* A room with a door: the office theme, now a plugin (sessionpipe-gui-themes/packages/office), ships its
     own copy in its manifest; this one stays for anything that wants the same mark. */
  office: (
    <>
      <path d="M3 16.5V5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 17 5v11.5" />
      <path d="M2.5 16.5h15" />
      <path d="M7.5 16.5v-5h5v5" />
    </>
  ),
};

/* The default glyph for an installed theme without an icon: a plug. */
const PLUG_ICON = (
  <>
    <path d="M7 3v4" />
    <path d="M13 3v4" />
    <path d="M4.5 7h11v3a5.5 5.5 0 0 1-11 0z" />
    <path d="M10 15.5V18" />
  </>
);

interface NavItem {
  to: string;
  key: string;
  label: string;
  /** Our line-icon paths on the 20 px grid, or… */
  glyph: ReactNode;
  /** …the theme's own inline SVG from its manifest. */
  svg?: string;
  experimental?: boolean;
}

const BUILTIN: NavItem[] = [
  { to: "/", key: "board", label: "Board", glyph: ICON.board },
  { to: "/feed", key: "feed", label: "Feed", glyph: ICON.feed },
  { to: "/machines", key: "machines", label: "Machines", glyph: ICON.machines },
  { to: "/connect", key: "connect", label: "Connect", glyph: ICON.connect },
];

/** A manifest icon is inline SVG the theme author wrote; it is code of the same trust
 *  as the theme itself, but a script-bearing one is refused all the same. */
const safeSvg = (svg: string | undefined): string | null => {
  if (!svg) return null;
  const s = svg.trim();
  if (!/^<svg[\s>]/i.test(s) || /<script|on[a-z]+\s*=|javascript:|<foreignObject|<iframe/i.test(s)) return null;
  return s;
};

export const themeNavItem = (t: InstalledTheme): NavItem => {
  const svg = safeSvg(t.icon);
  return {
    to: `/t/${encodeURIComponent(t.id)}`,
    key: `t:${t.id}`,
    label: t.name || t.id,
    glyph: PLUG_ICON,
    svg: svg ?? undefined,
    experimental: t.experimental,
  };
};

/** Builtins first, then installed themes, the experimental ones of both after a divider. */
export function navItems(themes: readonly InstalledTheme[]): NavItem[] {
  const plugins = themes.filter((t) => !t.error).map(themeNavItem);
  const all = [...BUILTIN, ...plugins];
  return [...all.filter((n) => !n.experimental), ...all.filter((n) => n.experimental)];
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  useGlobalKeys();
  const active = route.name === "session" ? "board" : route.name === "theme" ? `t:${route.id}` : route.name;
  const needs = [...useAppState().sessions.values()].filter((s) => s.state === "needs_you" && !s.parentId).length;
  const nav = navItems(useThemes().themes);
  const links = nav.map((n) => (
    <Link
      key={n.key}
      to={n.to}
      className={`nav-link ${active === n.key ? "nav-link--on" : ""}`}
      aria-current={active === n.key ? "page" : undefined}
      data-nav={n.key}
    >
      {n.svg ? (
        <span className="nav-glyph nav-glyph--svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: n.svg }} />
      ) : (
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
          {n.glyph}
        </svg>
      )}
      <span className="nav-label">{n.label}</span>
      {n.key === "board" && needs > 0 ? (
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
          {nav.map((n, i) => (
            <Fragment key={n.key}>
              {n.experimental && !nav[i - 1]?.experimental ? <span className="rail-group">experimental</span> : null}
              {links[i]}
            </Fragment>
          ))}
        </div>
        <div className="rail-foot">
          <Link
            to="/themes"
            className={`theme-btn ${route.name === "themes" ? "nav-link--on" : ""}`}
            title="Themes"
            aria-label="Themes"
            aria-current={route.name === "themes" ? "page" : undefined}
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
              {PLUG_ICON}
            </svg>
          </Link>
          <ConnectionPill />
          <QuickSettings placement="rail" />
        </div>
      </nav>
      <main className={`main ${route.name === "theme" ? "main--bleed" : ""}`} id="main">
        {children}
      </main>
      <nav className="tabbar" aria-label="Pages">
        {links}
        <QuickSettings placement="tabbar" />
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
