// SPDX-License-Identifier: Apache-2.0
// Keyboard: `/` focuses the page's search, `j`/`k` move a cursor through a list, Enter
// opens the item under it, Esc goes back (or blurs the search).
import { useCallback, useEffect, useState } from "react";
import { back, navigate } from "./router";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

export function focusSearch(): boolean {
  const el = document.querySelector<HTMLInputElement>("[data-search]");
  if (!el) return false;
  el.focus();
  el.select();
  return true;
}

/** Global `/` and Esc. Mounted once in the shell. */
export function useGlobalKeys(onBack: () => void = () => back("/")) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
        if (focusSearch()) e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (isTyping(e.target)) {
          (e.target as HTMLElement).blur();
          return;
        }
        const open = document.querySelector<HTMLElement>("[data-dismiss]");
        if (open) {
          open.click();
          return;
        }
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
}

/** j/k over a list of hrefs; Enter opens the one under the cursor. */
export function useListNav(hrefs: string[], enabled = true) {
  const [cursor, setCursor] = useState(-1);
  useEffect(() => {
    if (cursor >= hrefs.length) setCursor(hrefs.length - 1);
  }, [hrefs.length, cursor]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(hrefs.length - 1, c + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        const href = hrefs[cursor];
        if (href) {
          e.preventDefault();
          navigate(href);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hrefs, cursor, enabled]);

  useEffect(() => {
    if (cursor < 0) return;
    const el = document.querySelector<HTMLElement>(`[data-cursor="${CSS.escape(String(cursor))}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const reset = useCallback(() => setCursor(-1), []);
  return { cursor, reset };
}
