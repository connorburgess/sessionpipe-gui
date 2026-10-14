// SPDX-License-Identifier: Apache-2.0
// A history router: pushState, no hash. `useRoute()` gives the parsed location; `navigate`
// and `<Link>` move; the browser's back button works because we listen to popstate.
import { type CSSProperties, type MouseEvent, type ReactNode, useSyncExternalStore } from "react";

export type Route =
  | { name: "board" }
  | { name: "session"; harness: string; id: string }
  | { name: "feed" }
  | { name: "machines" }
  | { name: "connect" }
  | { name: "setup" }
  | { name: "themes" }
  | { name: "theme"; id: string }
  | { name: "pair"; code: string }
  | { name: "add-device" }
  | { name: "missing"; path: string };

const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
window.addEventListener("popstate", emit);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const current = () => location.pathname + location.search;

export function parseRoute(pathWithSearch: string): Route {
  const path = pathWithSearch.split("?")[0] ?? "/";
  if (path === "/" || path === "") return { name: "board" };
  if (path === "/feed") return { name: "feed" };
  if (path === "/machines") return { name: "machines" };
  if (path === "/connect") return { name: "connect" };
  if (path === "/setup") return { name: "setup" };
  if (path === "/themes") return { name: "themes" };
  if (path === "/add-device") return { name: "add-device" };
  const t = /^\/t\/([^/]+)\/?$/.exec(path);
  if (t?.[1]) return { name: "theme", id: decodeURIComponent(t[1]) };
  if (path === "/pair") {
    const q = pathWithSearch.indexOf("?");
    return { name: "pair", code: q >= 0 ? (new URLSearchParams(pathWithSearch.slice(q)).get("code") ?? "") : "" };
  }
  const m = /^\/s\/([^/]+)\/(.+)$/.exec(path);
  if (m?.[1] && m[2]) return { name: "session", harness: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) };
  return { name: "missing", path };
}

export function useRoute(): Route {
  const p = useSyncExternalStore(subscribe, current, current);
  return parseRoute(p);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, current, current);
}

/** The query parameters of the side panel: its tabs (`<harness>:<id>,…`) and the active one. */
export const SPLIT_PARAM = "s";
export const SPLIT_ACTIVE_PARAM = "t";

/** Keep `?mock=1` across navigations so a mock session survives a reload on any page, and
 *  the side panel (`?s=`) across page changes, except onto a session page of its own. */
function keepParams(to: string): string {
  const q = new URLSearchParams(location.search);
  const extra = new URLSearchParams();
  if (q.get("mock") === "1" && !to.includes("mock=1")) extra.set("mock", "1");
  const split = q.get(SPLIT_PARAM);
  if (split && !to.startsWith("/s/") && !/[?&]s=/.test(to)) {
    extra.set(SPLIT_PARAM, split);
    const active = q.get(SPLIT_ACTIVE_PARAM);
    if (active) extra.set(SPLIT_ACTIVE_PARAM, active);
  }
  const qs = extra.toString();
  if (!qs) return to;
  return `${to}${to.includes("?") ? "&" : "?"}${qs}`;
}
const keepMock = keepParams;

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const target = keepParams(to);
  if (target === current()) return;
  if (opts.replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  emit();
}

/** Sets or removes one query parameter on the current URL (a history entry each time, so
 *  back and forward walk through it). */
export function setSearchParam(name: string, value: string | null, opts: { replace?: boolean } = {}) {
  setSearchParams({ [name]: value }, opts);
}

/** Sets or removes several query parameters at once, as one history entry. */
export function setSearchParams(entries: Record<string, string | null>, opts: { replace?: boolean } = {}) {
  const q = new URLSearchParams(location.search);
  for (const [name, value] of Object.entries(entries)) {
    if (value === null) q.delete(name);
    else q.set(name, value);
  }
  const qs = q.toString();
  const target = `${location.pathname}${qs ? `?${qs}` : ""}`;
  if (target === current()) return;
  if (opts.replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  emit();
}

/** The current value of a query parameter, live. */
export function useSearchParam(name: string): string | null {
  const p = useSyncExternalStore(subscribe, current, current);
  const i = p.indexOf("?");
  return i < 0 ? null : new URLSearchParams(p.slice(i)).get(name);
}

export function back(fallback = "/") {
  if (history.length > 1 && document.referrer.startsWith(location.origin)) history.back();
  else if (history.length > 1) history.back();
  else navigate(fallback);
}

export const sessionPath = (harness: string, id: string) =>
  `/s/${encodeURIComponent(harness)}/${encodeURIComponent(id)}`;

export function Link({
  to,
  children,
  className,
  title,
  modClick,
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  title?: string;
  "aria-current"?: "page" | undefined;
  "data-cursor"?: string;
  "aria-label"?: string;
  style?: CSSProperties;
  tabIndex?: number;
  /** Shift- or Alt-click: open beside (the side panel); ⌘/ctrl-click: beside, as a
   *  background tab. Plain clicks navigate. */
  modClick?: (opts: { background: boolean }) => void;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey) {
      if (!modClick) return; // the browser's own "open in a new tab"
      e.preventDefault();
      modClick({ background: true });
      return;
    }
    if (e.shiftKey || e.altKey) {
      if (!modClick) return;
      e.preventDefault();
      modClick({ background: false });
      return;
    }
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={keepMock(to)} onClick={onClick} className={className} title={title} {...rest}>
      {children}
    </a>
  );
}
