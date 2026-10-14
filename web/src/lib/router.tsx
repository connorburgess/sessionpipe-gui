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
  | { name: "office" }
  | { name: "pair"; code: string }
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
  if (path === "/office") return { name: "office" };
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

/** Keep `?mock=1` across navigations so a mock session survives a reload on any page. */
function keepMock(to: string): string {
  const q = new URLSearchParams(location.search);
  if (q.get("mock") !== "1" || to.includes("mock=1")) return to;
  return `${to}${to.includes("?") ? "&" : "?"}mock=1`;
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const target = keepMock(to);
  if (target === current()) return;
  if (opts.replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  emit();
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
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={keepMock(to)} onClick={onClick} className={className} title={title} {...rest}>
      {children}
    </a>
  );
}
