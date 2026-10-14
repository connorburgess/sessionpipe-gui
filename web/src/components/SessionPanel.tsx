// SPDX-License-Identifier: Apache-2.0
// The side panel: a session open beside the current page (`?s=<harness>:<id>`), 44 % of
// the width by default, resizable at its left edge, remembered per device; a full-height
// sheet on phones. Opening from a rectangle (a card, a canvas window) morphs a ghost of
// it into the panel while the panel slides in and the page makes room; closing reverses.
import type { SessionSummary } from "@shared/api";
import { splitKey } from "@shared/api";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAppState } from "../data/hooks";
import { sessionTitle } from "../lib/format";
import { Link, sessionPath } from "../lib/router";
import {
  closeSplit,
  PAGE_MIN,
  type Rect,
  SPLIT_MIN,
  setSplitWidth,
  takeFrom,
  useSplitKey,
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

export function SessionPanel({ phone }: { phone: boolean }) {
  const key = useSplitKey();
  const width = useSplitWidth();
  const sessions = useAppState().sessions;
  /** What the body shows: lags `key` by a crossfade when one session replaces another,
   *  and by the slide-out when the panel closes. */
  const [shown, setShown] = useState<string | null>(key);
  const [fading, setFading] = useState(false);
  const [known, setKnown] = useState<SessionSummary | undefined>();
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const lastFrom = useRef<Rect | null>(null);
  const prevKey = useRef<string | null>(key);
  const open = key !== null;

  const panelRect = useCallback(
    (): Rect =>
      phone
        ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
        : { x: window.innerWidth - width, y: 0, width, height: window.innerHeight },
    [phone, width],
  );

  // Open, close, or replace.
  useEffect(() => {
    const was = prevKey.current;
    prevKey.current = key;
    if (key && !was) {
      const from = takeFrom();
      lastFrom.current = from;
      if (from) morph(from, panelRect());
      setShown(key);
      setFading(false);
      return;
    }
    if (!key && was) {
      const from = lastFrom.current;
      lastFrom.current = null;
      if (from) morph(panelRect(), from, { fadeIn: false });
      const t = setTimeout(() => setShown(null), reduced() ? 0 : MOTION_MS);
      return () => clearTimeout(t);
    }
    if (key && was && key !== was) {
      takeFrom();
      if (reduced()) {
        setShown(key);
        return;
      }
      setFading(true);
      const t = setTimeout(() => {
        setShown(key);
        setFading(false);
      }, 120);
      return () => clearTimeout(t);
    }
  }, [key, panelRect]);

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

  const s = shown ? (sessions.get(shown) ?? (known?.key === shown ? known : undefined)) : undefined;
  const { harness, id } = shown ? splitKey(shown) : { harness: "", id: "" };
  const title = s ? sessionTitle(s) : "Session";

  return (
    <aside
      ref={panelRef}
      className={`panel ${open ? "panel--open" : ""} ${phone ? "panel--sheet" : ""}`}
      aria-label="Session panel"
      aria-hidden={!open}
      data-split={open ? (shown ?? key) : undefined}
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
      <div className={`panel-body ${fading ? "panel-body--fading" : ""}`} ref={bodyRef}>
        {shown && (
          <SessionView
            key={shown}
            harness={harness}
            id={id}
            mode="panel"
            scrollRef={bodyRef}
            onSession={setKnown}
            onForgotten={closeSplit}
          />
        )}
      </div>
      <header className="panel-head">
        {s && <HarnessGlyph name={s.harness} size="sm" />}
        <h2 className="panel-title ellipsis" title={title}>
          {title}
        </h2>
        {s && <StateBadge state={s.state} since={s.stateSince} />}
        {shown && (
          <Link
            to={sessionPath(harness, id)}
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
    </aside>
  );
}
