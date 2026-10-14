// SPDX-License-Identifier: Apache-2.0
// The side panel: sessions open beside the current page, as tabs (`?s=<key>,…&t=<i>`).
// 44 % of the width by default, resizable at its left edge, remembered per device; a
// full-height sheet on phones. A tab strip (text tabs, a state dot, an underline on the
// active one), then the active session's header, then the bodies: every tab keeps its
// own scroller mounted up to MOUNTED_MAX, so its scroll position and loaded pages
// survive a switch. Opening from a rectangle morphs a ghost of it into the panel.
import type { SessionKey, SessionSummary } from "@shared/api";
import { splitKey } from "@shared/api";
import {
  createRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAppState } from "../data/hooks";
import { sessionTitle } from "../lib/format";
import { Link, sessionPath } from "../lib/router";
import {
  activateTab,
  closeSplit,
  closeTab,
  cycleTab,
  MOUNTED_MAX,
  moveTab,
  PAGE_MIN,
  type Rect,
  SPLIT_MIN,
  setSplitWidth,
  takeFrom,
  useSplit,
  useSplitWidth,
} from "../lib/split";
import { HarnessGlyph, StateBadge } from "./bits";
import { SessionView } from "./SessionView";

const MOTION_MS = 240;
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** A ghost rectangle animated from one viewport rect to another: transform and opacity only. */
function morph(from: Rect, to: Rect, opts: { fadeIn?: boolean } = {}): void {
  if (reduced() || from.width <= 0 || from.height <= 0) return;
  const el = document.createElement("div");
  el.className = "split-ghost";
  el.style.cssText = `left:${from.x}px;top:${from.y}px;width:${from.width}px;height:${from.height}px`;
  document.body.appendChild(el);
  const end = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.width / from.width}, ${to.height / from.height})`;
  const anim = el.animate(
    [
      { transform: "none", opacity: opts.fadeIn ? 0.4 : 0.9 },
      { transform: end, opacity: opts.fadeIn ? 0.9 : 0 },
    ],
    { duration: MOTION_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
  );
  anim.finished.then(() => el.remove()).catch(() => el.remove());
}

/** Tab labels: the session title, plus " · machine" only where two tabs share a title. */
function tabLabels(tabs: SessionKey[], summary: (k: SessionKey) => SessionSummary | undefined): string[] {
  const titles = tabs.map((k) => {
    const s = summary(k);
    return s ? sessionTitle(s) : splitKey(k).id.slice(0, 8);
  });
  return titles.map((t, i) => {
    const dup = titles.some((o, j) => j !== i && o === t);
    const m = summary(tabs[i]!)?.machine;
    return dup && m ? `${t} · ${m}` : t;
  });
}

export function SessionPanel({ phone }: { phone: boolean }) {
  const { tabs, active } = useSplit();
  const activeKey = tabs[active] ?? null;
  const width = useSplitWidth();
  const sessions = useAppState().sessions;
  /** Summaries the views learned, for tabs whose session is not in the snapshot. */
  const [known, setKnown] = useState<ReadonlyMap<SessionKey, SessionSummary>>(new Map());
  const summary = useCallback((k: SessionKey) => sessions.get(k) ?? known.get(k), [sessions, known]);
  const onSession = useCallback(
    (s: SessionSummary) => setKnown((m) => (m.get(s.key) === s ? m : new Map(m).set(s.key, s))),
    [],
  );

  /** Tabs whose SessionView is mounted, least recently used first. */
  const [mounted, setMounted] = useState<SessionKey[]>(activeKey ? [activeKey] : []);
  /** What the panel shows while it slides out: the tabs lag the URL by one animation. */
  const [shownTabs, setShownTabs] = useState<SessionKey[]>(tabs);
  const bodyRefs = useRef(new Map<SessionKey, RefObject<HTMLDivElement>>());
  const bodyRef = (k: SessionKey) => {
    let r = bodyRefs.current.get(k);
    if (!r) {
      r = createRef<HTMLDivElement>();
      bodyRefs.current.set(k, r);
    }
    return r;
  };
  const panelRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const lastFrom = useRef<Rect | null>(null);
  const wasOpen = useRef(tabs.length > 0);
  const open = tabs.length > 0;

  const panelRect = useCallback(
    (): Rect =>
      phone
        ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
        : { x: window.innerWidth - width, y: 0, width, height: window.innerHeight },
    [phone, width],
  );

  // Open and close: the morph in and out, and the body kept until the slide-out ends.
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (open) {
      setShownTabs(tabs);
      if (!was) {
        const from = takeFrom();
        lastFrom.current = from;
        if (from) morph(from, panelRect());
      } else takeFrom();
      return;
    }
    if (was) {
      const from = lastFrom.current;
      lastFrom.current = null;
      if (from) morph(panelRect(), from);
      const t = setTimeout(
        () => {
          setShownTabs([]);
          setMounted([]);
          bodyRefs.current.clear();
        },
        reduced() ? 0 : MOTION_MS,
      );
      return () => clearTimeout(t);
    }
  }, [open, tabs, panelRect]);

  // Which views stay mounted: the active one joins (most recent last); closed tabs leave;
  // past MOUNTED_MAX the least recently used goes.
  useEffect(() => {
    if (!activeKey) return;
    setMounted((prev) => {
      const next = prev.filter((k) => k !== activeKey && tabs.includes(k));
      next.push(activeKey);
      while (next.length > MOUNTED_MAX) {
        const drop = next.shift()!;
        bodyRefs.current.delete(drop);
      }
      return next;
    });
  }, [activeKey, tabs]);

  // The active tab scrolls into view in the strip.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeKey) return;
    const el = strip.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(activeKey)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced() ? "auto" : "smooth" });
    const overflow = strip.scrollWidth > strip.clientWidth + 1;
    strip.classList.toggle("tabs--overflow", overflow);
  }, [activeKey, tabs, width]);

  // Keyboard: ctrl+tab cycles, ⌘/ctrl+1…9 jump, ⌘/ctrl+w closes the active tab when the
  // panel has focus. (Browsers reserve some of these for their own tabs; they work where
  // the page is allowed to take them.)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < tabs.length) {
          e.preventDefault();
          activateTab(i);
        }
        return;
      }
      if (e.key === "w" && panelRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        closeTab(active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, tabs.length, active]);

  // The divider: drag to resize; the page keeps PAGE_MIN, the panel keeps SPLIT_MIN.
  const onGrip = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    document.documentElement.classList.add("split-dragging");
    const move = (ev: PointerEvent) => {
      const w = Math.max(SPLIT_MIN, Math.min(window.innerWidth - ev.clientX, window.innerWidth - PAGE_MIN));
      setSplitWidth(w);
    };
    const up = () => {
      document.documentElement.classList.remove("split-dragging");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };

  // Tabs reorder by drag: past 6 px the tab follows the pointer across its neighbours'
  // midpoints; a click that never moved activates.
  const [dragging, setDragging] = useState<SessionKey | null>(null);
  const onTabDown = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0) return;
    const tab = e.currentTarget;
    const strip = stripRef.current;
    if (!strip) return;
    const startX = e.clientX;
    let from = index;
    let moved = false;
    const pid = e.pointerId;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 6) return;
      if (!moved) {
        moved = true;
        tab.setPointerCapture(pid);
        setDragging(tabs[index]!);
      }
      const els = [...strip.querySelectorAll<HTMLElement>("[data-tab-key]")];
      let to = els.length - 1;
      for (let i = 0; i < els.length; i++) {
        const r = els[i]!.getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          to = i;
          break;
        }
      }
      if (to !== from) {
        moveTab(from, to);
        from = to;
      }
    };
    const up = () => {
      tab.removeEventListener("pointermove", move);
      tab.removeEventListener("pointerup", up);
      tab.removeEventListener("pointercancel", up);
      setDragging(null);
      if (!moved) activateTab(index);
    };
    tab.addEventListener("pointermove", move);
    tab.addEventListener("pointerup", up);
    tab.addEventListener("pointercancel", up);
  };
  const onTabAux = (e: ReactMouseEvent<HTMLDivElement>, index: number) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(index);
    }
  };

  const shown = open ? tabs : shownTabs;
  const s = activeKey ? summary(activeKey) : undefined;
  const labels = tabLabels(shown, summary);
  const title = s ? sessionTitle(s) : "Session";
  const bodies = open ? mounted : [];

  return (
    <aside
      ref={panelRef}
      className={`panel ${open ? "panel--open" : ""} ${phone ? "panel--sheet" : ""}`}
      aria-label="Session panel"
      aria-hidden={!open}
      data-split={activeKey ?? undefined}
    >
      {!phone && (
        // biome-ignore lint/a11y/useSemanticElements: a separator with pointer handling has no native element
        <div
          className="panel-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={Math.round(width)}
          onPointerDown={onGrip}
          tabIndex={-1}
        />
      )}
      <div className="panel-bodies">
        {bodies.map((k) => {
          const { harness, id } = splitKey(k);
          const isActive = k === activeKey;
          return (
            <div
              key={k}
              className={`panel-body ${isActive ? "" : "panel-body--off"}`}
              ref={bodyRef(k)}
              aria-hidden={!isActive}
              data-body={k}
            >
              <SessionView
                harness={harness}
                id={id}
                mode="panel"
                scrollRef={bodyRef(k)}
                onSession={onSession}
                onForgotten={() => closeTab(tabs.indexOf(k))}
              />
            </div>
          );
        })}
      </div>
      <header className="panel-head">
        {s && <HarnessGlyph name={s.harness} size="sm" />}
        <h2 className="panel-title ellipsis" title={title}>
          {title}
        </h2>
        {s && <StateBadge state={s.state} since={s.stateSince} />}
        {activeKey && (
          <Link
            to={sessionPath(splitKey(activeKey).harness, splitKey(activeKey).id)}
            className="theme-btn panel-btn"
            aria-label="Open as page"
            title="Open as page"
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
              <path d="M8 4H4.5A1.5 1.5 0 0 0 3 5.5v10A1.5 1.5 0 0 0 4.5 17h10a1.5 1.5 0 0 0 1.5-1.5V12" />
              <path d="M11 3h6v6" />
              <path d="M17 3l-7.5 7.5" />
            </svg>
          </Link>
        )}
        <button
          type="button"
          className="theme-btn panel-btn"
          onClick={closeSplit}
          aria-label="Close panel"
          title="Close (Esc)"
          data-dismiss
        >
          <svg
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </header>
      <div className="tabs" role="tablist" aria-label="Open sessions" ref={stripRef}>
        {shown.map((k, i) => {
          const sm = summary(k);
          const isActive = k === activeKey;
          return (
            <div
              key={k}
              className={`tab ${isActive ? "tab--active" : ""} ${dragging === k ? "tab--dragging" : ""}`}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              data-tab-key={k}
              title={labels[i]}
              onPointerDown={(e) => onTabDown(e, i)}
              onAuxClick={(e) => onTabAux(e, i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activateTab(i);
                }
              }}
            >
              <span className={`tab-dot tab-dot--${sm?.state ?? "idle"}`} aria-hidden="true" />
              <span className="tab-title">{labels[i]}</span>
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${labels[i]}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(i);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
