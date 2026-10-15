// src/types.ts
var emptyLayout = () => ({ v: 1, windows: {}, zones: {}, zonesOn: false, shelfOpen: false });
var ZOOM_MIN = 0.25;
var ZOOM_MAX = 2;
var GRID = 8;
var WIN_W = 280;
var WIN_H = 212;
var SUB_W = 224;
var SUB_H = 68;
var EXP_W = 580;
var EXP_H = 440;
var MIN_W = 200;
var MIN_H = 110;
var MAX_W = 1400;
var MAX_H = 1e3;
var GAP = 16;
var TREE_GAP = 28;
var TREE_ROW = 8;
var LANE_GAP = 40;
var NODE_H = 36;
var NODE_GAP = 20;

// src/util.ts
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== void 0) e.textContent = text;
  return e;
}
function svg(tag, attrs) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function setText(e, text) {
  if (e.textContent !== text) e.textContent = text;
}
function setClass(e, cls, on) {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}
var reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
function debounce(ms2, fn) {
  let t;
  let last;
  const d = (...a) => {
    last = a;
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = void 0;
      if (last) fn(...last);
      last = void 0;
    }, ms2);
  };
  d.flush = () => {
    if (t) clearTimeout(t);
    t = void 0;
    if (last) fn(...last);
    last = void 0;
  };
  return d;
}
var ms = (iso) => iso ? Date.parse(iso) : Number.NaN;
function oneLine(s, max) {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}\u2026` : t;
}
var isTouchLike = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

// src/input.ts
var TAP_MS = 350;
var DRAG_PX = 3;
function attachInput(host) {
  const root = host.root;
  const pointers = /* @__PURE__ */ new Map();
  let mode = { kind: "none" };
  let space = false;
  let lastTap;
  const pt = (e) => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const snap = (v, on) => on ? Math.round(v / GRID) * GRID : v;
  const startPinch = () => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    mode = { kind: "pinch", d0, k0: host.vp().k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    root.classList.add("is-panning");
  };
  const onDown = (e) => {
    const hit = host.hit(e.target);
    if (hit.kind === "ui") return;
    if (hit.kind === "win" && hit.part === "control") return;
    if (hit.kind === "win" && hit.part === "scroll" && !space) {
      host.focusWin(hit.key);
      return;
    }
    if (e.button !== void 0 && e.button !== 0 && e.pointerType === "mouse") return;
    const p = pt(e);
    pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, type: e.pointerType });
    root.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch" && pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 1) return;
    const v = host.vp();
    if (hit.kind === "node" && hit.part === "edit") {
      pointers.delete(e.pointerId);
      return;
    }
    if (space || hit.kind === "canvas" || hit.kind === "link") {
      if (hit.kind === "link") host.select(hit.id);
      else host.select(null);
      mode = { kind: "pan", sx: p.x, sy: p.y, vx: v.x, vy: v.y };
      root.classList.add("is-panning");
    } else if (hit.kind === "node") {
      if (hit.part === "handle") {
        mode = { kind: "link", id: hit.id };
        host.beginLink(hit.id);
      } else if (hit.part === "chip" && hit.chip) {
        mode = { kind: "ghost", chip: hit.chip };
        host.beginGhost(hit.chip, p.x, p.y);
      } else {
        const r = host.nodeRect(hit.id);
        if (!r) return;
        mode = { kind: "node", id: hit.id, sx: p.x, sy: p.y, ox: r.x, oy: r.y, custom: hit.custom, moved: false };
      }
    } else if (hit.kind === "win") {
      host.focusWin(hit.key);
      const r = host.winRect(hit.key);
      if (!r) return;
      if (hit.part === "resize") mode = { kind: "resize", key: hit.key, sx: p.x, sy: p.y, ow: r.w, oh: r.h };
      else mode = { kind: "drag", key: hit.key, part: hit.part, sx: p.x, sy: p.y, ox: r.x, oy: r.y, moved: false };
    } else if (hit.kind === "zone") {
      const r = host.zoneRect(hit.name);
      if (!r) return;
      if (hit.part === "resize") mode = { kind: "zone-resize", name: hit.name, sx: p.x, sy: p.y, ow: r.w, oh: r.h };
      else mode = { kind: "zone", name: hit.name, sx: p.x, sy: p.y, ox: r.x, oy: r.y };
    }
    if (mode.kind !== "none" && e.pointerType === "mouse") e.preventDefault();
    if (mode.kind !== "none" && e.pointerType === "touch") root.classList.add("is-touch-drag");
  };
  const onMove = (e) => {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    const p = pt(e);
    rec.x = p.x;
    rec.y = p.y;
    const k = host.vp().k;
    switch (mode.kind) {
      case "pan":
        host.panBy(p.x - mode.sx, p.y - mode.sy);
        mode.sx = p.x;
        mode.sy = p.y;
        break;
      case "drag": {
        const dx = (p.x - mode.sx) / k;
        const dy = (p.y - mode.sy) / k;
        if (!mode.moved && Math.hypot(p.x - mode.sx, p.y - mode.sy) < DRAG_PX) return;
        if (!mode.moved) {
          mode.moved = true;
          root.classList.add("is-dragging");
        }
        host.moveWin(mode.key, snap(mode.ox + dx, e.shiftKey), snap(mode.oy + dy, e.shiftKey));
        break;
      }
      case "resize":
        host.resizeWin(
          mode.key,
          snap(mode.ow + (p.x - mode.sx) / k, e.shiftKey),
          snap(mode.oh + (p.y - mode.sy) / k, e.shiftKey)
        );
        break;
      case "zone":
        host.moveZone(
          mode.name,
          snap(mode.ox + (p.x - mode.sx) / k, e.shiftKey),
          snap(mode.oy + (p.y - mode.sy) / k, e.shiftKey)
        );
        break;
      case "zone-resize":
        host.resizeZone(mode.name, mode.ow + (p.x - mode.sx) / k, mode.oh + (p.y - mode.sy) / k);
        break;
      case "node": {
        if (!mode.moved && Math.hypot(p.x - mode.sx, p.y - mode.sy) < DRAG_PX) return;
        if (!mode.moved) {
          mode.moved = true;
          root.classList.add("is-dragging");
        }
        const nx = snap(mode.ox + (p.x - mode.sx) / k, e.shiftKey);
        const ny = mode.custom ? snap(mode.oy + (p.y - mode.sy) / k, e.shiftKey) : mode.oy;
        host.moveNode(mode.id, nx, ny);
        break;
      }
      case "link": {
        const w = host.toWorld(p.x, p.y);
        host.moveLink(w.x, w.y);
        break;
      }
      case "ghost":
        host.moveGhost(p.x, p.y);
        break;
      case "pinch": {
        const [a, b] = [...pointers.values()];
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const target = clamp(mode.k0 * (d / mode.d0), 0.25, 2);
        const cur = host.vp().k;
        if (Math.abs(target - cur) > 1e-4) host.zoomAt(mx, my, target / cur);
        host.panBy(mx - mode.mx, my - mode.my);
        mode.mx = mx;
        mode.my = my;
        break;
      }
    }
  };
  const onUp = (e) => {
    const had = pointers.delete(e.pointerId);
    if (!had) return;
    try {
      root.releasePointerCapture(e.pointerId);
    } catch {
    }
    if (mode.kind === "pinch") {
      if (pointers.size === 0) end();
      return;
    }
    const p = pt(e);
    if (mode.kind === "link") {
      const t = host.hitAt(p.x, p.y);
      host.endLink(t.kind === "node" ? t.chip ?? t.id : t.kind === "win" ? `win:${t.key}` : null);
    } else if (mode.kind === "ghost") {
      const t = host.hitAt(p.x, p.y);
      host.endGhost(t.kind === "node" ? t.id : null);
    } else if (mode.kind === "node" && !mode.moved) {
      host.select(mode.id);
    }
    if (mode.kind === "drag" && !mode.moved) {
      const now = performance.now();
      const onBar = mode.part === "bar";
      if (onBar && lastTap && lastTap.key === mode.key && now - lastTap.at < TAP_MS) {
        host.toggleExpand(mode.key);
        lastTap = void 0;
      } else lastTap = { key: mode.key, at: now };
    }
    end();
  };
  const end = () => {
    const was = mode.kind;
    mode = { kind: "none" };
    root.classList.remove("is-panning", "is-dragging", "is-touch-drag");
    if (was !== "none" && was !== "pan" && was !== "pinch") host.commit();
    else if (was === "pan" || was === "pinch") host.commit();
  };
  const onWheel = (e) => {
    const hit = host.hit(e.target);
    if (hit.kind === "ui") return;
    if (hit.kind === "win" && hit.part === "scroll" && !e.ctrlKey && !e.metaKey) {
      const list = e.target.closest(".cv-detail-list");
      if (list && list.scrollHeight > list.clientHeight) {
        const atTop = list.scrollTop <= 0 && e.deltaY < 0;
        const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return;
      }
    }
    e.preventDefault();
    const p = pt(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1;
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey && Math.abs(e.deltaY) < 50 ? 0.01 : 25e-4));
      host.zoomAt(p.x, p.y, factor);
    } else {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      host.panBy(-dx * unit, -dy * unit);
    }
    wheelCommit();
  };
  let wheelTimer;
  const wheelCommit = () => {
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => host.commit(), 250);
  };
  const ours = () => {
    const a = document.activeElement;
    return !a || a === document.body || a === document.documentElement || root.contains(a);
  };
  const act = (fn, commit = true) => () => {
    if (!ours() || host.busyTyping()) return;
    fn();
    if (commit) host.commit();
  };
  const nudge = (dx, dy) => act(() => host.nudgeFocused(dx, dy));
  const far = GRID * 4;
  const unregister = host.shortcuts?.register([
    { id: "fit", label: "Fit everything", keys: ["0"], run: act(() => host.fit()) },
    { id: "zoom-in", label: "Zoom in", keys: ["plus", "="], run: act(() => host.zoomStep(1)) },
    { id: "zoom-out", label: "Zoom out", keys: ["-", "_"], run: act(() => host.zoomStep(-1)) },
    { id: "left", label: "Move the focused window left", keys: ["left"], run: nudge(-GRID, 0), hint: "one cell" },
    { id: "right", label: "Move the focused window right", keys: ["right"], run: nudge(GRID, 0), hint: "one cell" },
    { id: "up", label: "Move the focused window up", keys: ["up"], run: nudge(0, -GRID), hint: "one cell" },
    { id: "down", label: "Move the focused window down", keys: ["down"], run: nudge(0, GRID), hint: "one cell" },
    { id: "left-far", label: "Move left, four cells", keys: ["shift+left"], run: nudge(-far, 0) },
    { id: "right-far", label: "Move right, four cells", keys: ["shift+right"], run: nudge(far, 0) },
    { id: "up-far", label: "Move up, four cells", keys: ["shift+up"], run: nudge(0, -far) },
    { id: "down-far", label: "Move down, four cells", keys: ["shift+down"], run: nudge(0, far) },
    { id: "open", label: "Open the focused window", keys: ["enter"], run: act(() => host.enterFocused()) },
    {
      id: "delete",
      label: "Delete the selected link or node",
      keys: ["backspace", "delete"],
      run: act(() => {
        host.deleteSelected();
      })
    },
    { id: "allow", label: "Allow the focused prompt", keys: ["a"], run: act(() => host.answerFocused("allow"), false) },
    { id: "deny", label: "Deny the focused prompt", keys: ["d"], run: act(() => host.answerFocused("deny"), false) },
    { id: "search", label: "Search the canvas", keys: ["/"], run: act(() => host.focusSearch(), false) },
    { id: "legend", label: "Legend", keys: ["?"], run: act(() => host.toggleLegend(), false) }
  ]);
  const viaHost = !!unregister;
  const onKey = (e) => {
    if (!ours()) return;
    const t = e.target;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (typing) {
      if (e.key === "Escape") {
        host.clearSearch();
        t.blur();
        root.focus();
        e.preventDefault();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (host.busyTyping()) return;
    if (viaHost && e.key !== " " && e.key !== "Escape") return;
    const step = e.shiftKey ? GRID * 4 : GRID;
    switch (e.key) {
      case "Backspace":
      case "Delete":
        if (!host.deleteSelected()) return;
        break;
      case "a":
        host.answerFocused("allow");
        return;
      case "d":
        host.answerFocused("deny");
        return;
      case " ":
        space = true;
        root.classList.add("is-space");
        e.preventDefault();
        return;
      case "/":
        host.focusSearch();
        e.preventDefault();
        return;
      case "?":
        host.toggleLegend();
        e.preventDefault();
        return;
      case "Escape":
        host.clearSearch();
        if (t && t !== root) root.focus();
        return;
      case "0":
        host.fit();
        break;
      case "+":
      case "=":
        host.zoomStep(1);
        break;
      case "-":
      case "_":
        host.zoomStep(-1);
        break;
      case "ArrowLeft":
        host.nudgeFocused(-step, 0);
        break;
      case "ArrowRight":
        host.nudgeFocused(step, 0);
        break;
      case "ArrowUp":
        host.nudgeFocused(0, -step);
        break;
      case "ArrowDown":
        host.nudgeFocused(0, step);
        break;
      case "Enter":
        host.enterFocused();
        break;
      default:
        return;
    }
    e.preventDefault();
    host.commit();
  };
  const onKeyUp = (e) => {
    if (e.key === " ") {
      space = false;
      root.classList.remove("is-space");
    }
  };
  const onDbl = (e) => {
    if (host.hit(e.target).kind !== "ui") e.preventDefault();
  };
  const onBlur = () => {
    space = false;
    root.classList.remove("is-space");
  };
  const onOver = (e) => {
    if (mode.kind !== "none") return;
    const hit = host.hit(e.target);
    host.hover(hit.kind === "node" ? hit.chip ?? hit.id : hit.kind === "win" ? `win:${hit.key}` : null);
  };
  const onLeave = () => host.hover(null);
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
  root.addEventListener("dblclick", onDbl);
  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerleave", onLeave);
  window.addEventListener("blur", onBlur);
  return () => {
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerup", onUp);
    root.removeEventListener("pointercancel", onUp);
    root.removeEventListener("wheel", onWheel);
    document.removeEventListener("keydown", onKey);
    unregister?.();
    document.removeEventListener("keyup", onKeyUp);
    root.removeEventListener("dblclick", onDbl);
    root.removeEventListener("pointerover", onOver);
    root.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("blur", onBlur);
    if (wheelTimer) clearTimeout(wheelTimer);
  };
}

// src/layout.ts
var overlaps = (a, b, pad = GAP) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
function bounds(rects) {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const r of rects) {
    any = true;
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
function findFree(centre, w, h, taken, step = 40) {
  const cx = Math.round((centre.x - w / 2) / step) * step;
  const cy = Math.round((centre.y - h / 2) / step) * step;
  const free = (x, y) => {
    const r = { x, y, w, h };
    for (const t of taken) if (overlaps(r, t)) return false;
    return true;
  };
  if (free(cx, cy)) return { x: cx, y: cy, w, h };
  for (let ring = 1; ring < 80; ring++) {
    const candidates = [];
    for (let i = -ring; i <= ring; i++) {
      candidates.push([cx + ring * step, cy + i * step]);
      candidates.push([cx - ring * step, cy + i * step]);
      if (Math.abs(i) !== ring) {
        candidates.push([cx + i * step, cy + ring * step]);
        candidates.push([cx + i * step, cy - ring * step]);
      }
    }
    candidates.sort((a, b) => dist(a, cx, cy) - dist(b, cx, cy));
    for (const [x, y] of candidates) if (free(x, y)) return { x, y, w, h };
  }
  return { x: cx + 80 * step, y: cy, w, h };
}
var dist = (p, x, y) => (p[0] - x) ** 2 + (p[1] - y) ** 2;
function hangKids(kids, parent, pos, out) {
  let y = 0;
  for (const c of kids) {
    const cp = pos(c.key);
    out.set(c.key, { x: parent.w + TREE_GAP, y });
    y += cp.h + TREE_ROW;
  }
  return Math.max(0, y - TREE_ROW - parent.h);
}
function treeWidth(kids, parent, pos) {
  if (!kids.length) return parent.w;
  return parent.w + TREE_GAP + Math.max(...kids.map((c) => pos(c.key).w));
}
var STATE_ORDER = ["needs_you", "working", "stale", "idle"];
function tidy(sessions, pos, byMachine, stack = false) {
  const windows = /* @__PURE__ */ new Map();
  const zones = /* @__PURE__ */ new Map();
  const parents = sessions.filter((s) => !s.parentId && s.state !== "done");
  const children = sessions.filter((s) => s.parentId && s.state !== "done");
  if (stack) {
    const order = [...parents].sort(
      (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastAt.localeCompare(a.lastAt)
    );
    let y = 0;
    for (const s of order) {
      const p = pos(s.key);
      windows.set(s.key, { x: 0, y });
      let ky = p.h + TREE_ROW;
      for (const c of children.filter((c2) => c2.parentId === s.id)) {
        windows.set(c.key, { x: 0, y: ky });
        ky += pos(c.key).h + TREE_ROW;
      }
      y += Math.max(p.h, ky - TREE_ROW) + GAP;
    }
    return { windows, zones };
  }
  const groups = /* @__PURE__ */ new Map();
  for (const s of parents) {
    const g = byMachine ? s.machine ?? "?" : "";
    const list = groups.get(g) ?? [];
    list.push(s);
    groups.set(g, list);
  }
  let x = 0;
  const ZPAD = 40;
  const rows = Math.max(4, Math.ceil(Math.sqrt(parents.length * 0.9)));
  for (const [machine, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const x0 = x;
    let maxY = 0;
    for (const state of STATE_ORDER) {
      const col = list.filter((s) => s.state === state).sort((a, b) => a.lastAt.localeCompare(b.lastAt)).reverse();
      if (!col.length) continue;
      let y = 0;
      let colW = 0;
      let n = 0;
      for (const s of col) {
        if (n === rows) {
          x += colW + GAP;
          y = 0;
          colW = 0;
          n = 0;
        }
        const p = pos(s.key);
        windows.set(s.key, { x, y });
        const kids = children.filter((c) => c.parentId === s.id);
        const kidH = hangKids(kids, p, pos, windows);
        y += p.h + kidH + GAP;
        colW = Math.max(colW, treeWidth(kids, p, pos));
        n++;
        maxY = Math.max(maxY, y);
      }
      x += colW + GAP;
    }
    if (byMachine) {
      zones.set(machine, { x: x0 - ZPAD, y: -ZPAD - 8, w: x - GAP - x0 + ZPAD * 2, h: maxY - GAP + ZPAD * 2 + 8 });
      x += ZPAD * 2 + GAP;
    }
  }
  return { windows, zones };
}

// src/map.ts
var LANES = ["devices", "", "agents", "machines", "storage"];
var HUB_H = 28;
var BUS_GAP = 14;
var MIN_LANE_W = 960;
var LANE_PAD = 80;
var MapLayer = class {
  constructor(host) {
    this.host = host;
    this.lanesEl = el("div", "cv-lanes");
    this.nodesEl = el("div", "cv-nodes");
    this.customEl = el("div", "cv-nodes cv-nodes-custom");
    this.edgesG = svg("g", { class: "cv-edges" });
    this.tempLine = svg("line", { class: "cv-edge cv-edge-custom is-temp" });
    this.tempLine.style.display = "none";
    host.tethers.append(this.edgesG, this.tempLine);
    for (const name of LANES) {
      const lane = el("div", "cv-lane");
      lane.dataset.lane = name;
      lane.append(el("span", "cv-lane-l", name));
      this.lanesEl.append(lane);
      this.laneEls.push(lane);
    }
    this.lanesEl.hidden = true;
    this.nodesEl.hidden = true;
    this.customEl.hidden = true;
  }
  lanesEl;
  nodesEl;
  /** Hand-drawn nodes sit above the windows: they are annotations. */
  customEl;
  edgesG;
  tempLine;
  laneEls = [];
  nodes = /* @__PURE__ */ new Map();
  edges = [];
  sig = "";
  focus = null;
  selected = null;
  ghost;
  ghostChip;
  pop;
  linkFrom;
  laneRect = { x: 0, y: 0, w: 0, h: 0 };
  rows = [];
  editing;
  setOn(on) {
    this.lanesEl.hidden = !on;
    this.nodesEl.hidden = !on;
    this.customEl.hidden = !on;
    if (on) this.sig = "";
    if (!on) {
      this.edgesG.replaceChildren();
      this.lineEls.clear();
      this.trunkEls.clear();
      this.closePopover();
      this.setFocus(null);
    }
  }
  // ---------- nodes from the snapshot ----------
  /** Rebuild the node set when it changed; always returns whether a redraw is due. */
  build() {
    const s = this.host.snapshot();
    const lay = this.host.layout();
    const want = [];
    for (const v of s.viewers) {
      want.push({
        id: `dev:${v.id}`,
        kind: "device",
        lane: 0,
        label: v.label || v.device,
        sub: v.current ? "you" : v.loopback ? "this machine" : [v.device, v.ip].filter(Boolean).join(" \xB7 "),
        current: v.current
      });
    }
    const keys = /* @__PURE__ */ new Map();
    for (const m of s.machines.values()) {
      for (const k of m.control?.keys ?? []) {
        const name = k.name?.trim();
        if (!name) continue;
        const list = keys.get(name) ?? [];
        list.push(m.name);
        keys.set(name, list);
      }
    }
    for (const [name, machines] of keys) {
      if ([...s.viewers].some((v) => v.label === name)) continue;
      want.push({
        id: `dev:key:${name}`,
        kind: "device",
        lane: 0,
        label: name,
        sub: `passkey \xB7 ${machines.join(", ")}`
      });
    }
    want.push({ id: "hub", kind: "hub", lane: 1, label: this.host.api.host.name, sub: this.host.api.host.version });
    const emails = /* @__PURE__ */ new Map();
    for (const m of s.machines.values()) {
      for (const a of m.control?.accounts ?? []) if (a.email) emails.set(`${a.harness}:${a.id}`, a.email);
    }
    const groups = /* @__PURE__ */ new Map();
    for (const sess of s.sessions.values()) {
      if (sess.parentId) continue;
      const g = groups.get(sess.harness) ?? /* @__PURE__ */ new Map();
      groups.set(sess.harness, g);
      if (sess.accountId && !g.has(sess.accountId)) {
        const id = `acct:${sess.harness}:${sess.accountId}`;
        g.set(sess.accountId, {
          id,
          harness: sess.harness,
          accountId: sess.accountId,
          label: emails.get(`${sess.harness}:${sess.accountId}`) ?? sess.accountId.slice(0, 8),
          x: 0,
          w: 0
        });
      }
    }
    for (const [harness, chips] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      want.push({
        id: `agent:${harness}`,
        kind: "agent",
        lane: 2,
        label: harnessShort(harness),
        chips: [...chips.values()]
      });
    }
    for (const m of [...s.machines.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const c = m.control;
      const versions = Object.entries(m.harnesses).filter(([, v]) => v).map(([h, v]) => `${this.host.api.format.monogram(h)} ${v}`).join(" \xB7 ");
      const sub = c ? c.online ? versions || "online" : "offline" : "not paired";
      let strength = "idle";
      for (const sess of s.sessions.values()) {
        if (sess.machine !== m.name || sess.parentId) continue;
        if (sess.state === "needs_you") strength = "needs";
        else if (sess.state === "working" && strength !== "needs") strength = "working";
        else if (sess.state === "stale" && strength === "idle") strength = "stale";
      }
      want.push({
        id: `machine:${m.name}`,
        kind: "machine",
        lane: 3,
        label: m.name,
        sub,
        machine: m.name,
        machineId: c?.machineId,
        online: !!c?.online,
        needs: m.needsYou > 0,
        strength
      });
    }
    const repos = /* @__PURE__ */ new Map();
    for (const sess of s.sessions.values()) {
      if (!sess.repo) continue;
      const { short, host } = repoParts(sess.repo);
      repos.set(short, host);
    }
    for (const [short, host] of [...repos].sort((a, b) => a[0].localeCompare(b[0]))) {
      want.push({ id: `repo:${short}`, kind: "repo", lane: 4, label: short, sub: host });
    }
    for (const c of Object.values(lay.custom ?? {})) {
      if (!c.label?.trim() && c.id !== this.editing) {
        delete lay.custom[c.id];
        lay.links = (lay.links ?? []).filter((k) => k.from !== c.id && k.to !== c.id);
        continue;
      }
      want.push({ id: c.id, kind: "custom", lane: -1, label: c.label });
    }
    if (lay.nodes) {
      const ids = new Set(want.map((n) => n.id));
      for (const id of Object.keys(lay.nodes)) if (!ids.has(id)) delete lay.nodes[id];
    }
    const wins = this.host.liveWindows();
    const cx = (sess) => {
      const w = wins.find((x) => x.session.key === sess.key);
      return w ? w.rect.x + w.rect.w / 2 : void 0;
    };
    for (const n of want) {
      if (!n.chips?.length) continue;
      const bary = /* @__PURE__ */ new Map();
      for (const c of n.chips) {
        const xs = [];
        for (const sess of s.sessions.values()) {
          if (sess.parentId || sess.harness !== c.harness || sess.accountId !== c.accountId) continue;
          const x = cx(sess);
          if (x !== void 0) xs.push(x);
        }
        bary.set(c.id, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY);
      }
      n.chips.sort((a, b) => bary.get(a.id) - bary.get(b.id));
    }
    const sig = want.map(
      (n) => [n.id, n.label, n.sub, n.online, n.needs, n.current, n.strength, n.chips?.map((c) => c.label).join("|")].join(
        ""
      )
    ).join("");
    const hidden = this.nodesEl.hidden;
    const changed = sig !== this.sig;
    if (changed) {
      this.sig = hidden ? "" : sig;
      const seen = /* @__PURE__ */ new Set();
      for (const n of want) {
        seen.add(n.id);
        let node = this.nodes.get(n.id);
        if (!node) {
          const e = this.nodeEl(n);
          (n.kind === "custom" ? this.customEl : this.nodesEl).append(e);
          node = { ...n, x: 0, y: 0, w: 0, h: NODE_H, el: e };
          this.nodes.set(n.id, node);
        } else {
          Object.assign(node, n);
          this.fillNode(node);
        }
        node.w = node.el.offsetWidth || node.w;
        node.h = node.el.offsetHeight || NODE_H;
        for (const c of node.chips ?? []) {
          const ce = node.el.querySelector(`[data-chip="${CSS.escape(c.id)}"]`);
          if (ce) {
            c.x = ce.offsetLeft;
            c.w = ce.offsetWidth;
          }
        }
      }
      for (const [id, node] of this.nodes) {
        if (!seen.has(id)) {
          node.el.remove();
          this.nodes.delete(id);
          if (this.selected === id) this.selected = null;
        }
      }
    }
    this.edges = this.computeEdges();
    return changed;
  }
  nodeEl(n) {
    const e = el("div", `cv-node cv-node-${n.kind}`);
    e.dataset.id = n.id;
    e.dataset.kind = n.kind;
    e.tabIndex = 0;
    const node = { ...n, x: 0, y: 0, w: 0, h: NODE_H, el: e };
    this.fillNode(node);
    return e;
  }
  fillNode(n) {
    const e = n.el;
    e.replaceChildren();
    if (n.kind === "machine") {
      const dot = el("span", "cv-node-dot");
      setClass(dot, "is-on", !!n.online);
      dot.dataset.s = n.strength ?? "idle";
      e.append(dot);
    }
    if (n.kind === "custom") {
      const l = el("span", "cv-node-l cv-node-edit", n.label);
      l.spellcheck = false;
      e.append(l);
    } else {
      e.append(el("span", "cv-node-l", n.label));
    }
    if (n.sub) e.append(el("span", "cv-node-s", n.sub));
    if (n.needs) {
      const nd = el("span", "cv-node-needs");
      nd.title = "A session here needs you";
      e.append(nd);
    }
    for (const c of n.chips ?? []) {
      const chip = el("span", "cv-chip-a", c.label);
      chip.dataset.chip = c.id;
      chip.dataset.harness = c.harness;
      chip.dataset.account = c.accountId;
      chip.title = `${c.label} \xB7 drag onto a machine to start a session`;
      e.append(chip);
    }
    const h = el("span", "cv-node-h");
    h.title = "Drag to another node to link";
    e.append(h);
    setClass(e, "is-current", !!n.current);
    setClass(e, "is-off", n.kind === "machine" && !n.online);
    setClass(e, "is-selected", this.selected === n.id);
  }
  // ---------- geometry ----------
  /** Lanes are as wide as the sessions (at least MIN_LANE_W) and their nodes pack into
   *  rows inside that width, so nothing can leave its lane: a node keeps the x it was
   *  dragged to while it fits on its row, and wraps when it does not. Positions are
   *  relative to the lane's left edge (`lanes.x`); a stored x outside the lane is dropped. */
  layoutNodes() {
    const lay = this.host.layout();
    const wins = this.host.liveWindows();
    const b = bounds(wins.map((w) => w.rect)) ?? { x: -300, y: -120, w: 600, h: 240 };
    if (!lay.lanes || lay.lanes.x === void 0) lay.lanes = this.defaultLanes(b);
    lay.nodes ??= {};
    const narrow = this.host.narrow();
    const W = narrow ? Math.max(b.w, 360) : Math.max(MIN_LANE_W, b.w + LANE_PAD * 2);
    const PAD = 12;
    const ROW = NODE_H + 8;
    const laneX = lay.lanes.x;
    const placed = /* @__PURE__ */ new Map();
    const rowsOf = [];
    for (let lane = 0; lane < LANES.length; lane++) {
      const members = [...this.nodes.values()].filter((n) => n.lane === lane);
      const stored = (n) => {
        const st = lay.nodes?.[n.id];
        if (!st || !Number.isFinite(st.x) || st.x < 0 || st.x + n.w > W - PAD) return void 0;
        return st.x;
      };
      const bary = new Map(members.map((n) => [n.id, this.barycenter(n.id)]));
      members.sort((p, q) => {
        const a = stored(p);
        const c = stored(q);
        if (a === void 0 && c === void 0)
          return bary.get(p.id) - bary.get(q.id) || p.label.localeCompare(q.label);
        if (a === void 0) return 1;
        if (c === void 0) return -1;
        return a - c;
      });
      let cursor = PAD;
      let row = 0;
      for (const n of members) {
        const want = stored(n);
        let x = want !== void 0 && want >= cursor && want + n.w <= W - PAD ? want : cursor;
        if (x + n.w > W - PAD && cursor > PAD) {
          row++;
          cursor = PAD;
          x = PAD;
        }
        placed.set(n.id, { x, row });
        if (want === void 0 || want !== x) lay.nodes[n.id] = { x };
        cursor = x + n.w + NODE_GAP;
      }
      rowsOf[lane] = row + 1;
    }
    const laneH = (lane) => lane === 1 ? HUB_H + 12 : rowsOf[lane] * ROW + 20;
    const { top, bottom } = lay.lanes;
    const gap = narrow ? LANE_GAP - 16 : LANE_GAP;
    const agentsY = top - laneH(2);
    const hubY = agentsY - gap - laneH(1);
    const devicesY = hubY - gap - laneH(0);
    this.rows = [
      { y: devicesY, h: laneH(0) },
      { y: hubY, h: laneH(1) },
      { y: agentsY, h: laneH(2) },
      { y: bottom, h: laneH(3) },
      { y: bottom + laneH(3) + gap, h: laneH(4) }
    ];
    for (const n of this.nodes.values()) {
      if (n.kind === "custom") {
        const c = lay.custom?.[n.id];
        if (c) {
          n.x = c.x;
          n.y = c.y;
        }
        continue;
      }
      const p = placed.get(n.id);
      if (!p) continue;
      const row = this.rows[n.lane];
      n.x = laneX + p.x;
      n.y = row.y + (n.lane === 1 ? (row.h - n.h) / 2 : 10 + p.row * ROW);
    }
    const last = this.rows[4];
    this.laneRect = { x: laneX, y: devicesY, w: W, h: last.y + last.h - devicesY };
  }
  /** Where the lanes are, for Fit. */
  laneBounds() {
    return this.lanesEl.hidden ? null : this.laneRect;
  }
  defaultLanes(b) {
    const narrow = this.host.narrow();
    const w = narrow ? Math.max(b.w, 360) : Math.max(MIN_LANE_W, b.w + LANE_PAD * 2);
    return { x: b.x - (narrow ? 0 : (w - b.w) / 2), top: b.y - LANE_GAP - 8, bottom: b.y + b.h + LANE_GAP + 8 };
  }
  /** Tidy: lanes hug the windows again and the nodes pack from the left. */
  relayout() {
    const lay = this.host.layout();
    const b = bounds(this.host.liveWindows().map((w) => w.rect));
    lay.lanes = this.defaultLanes(b ?? { x: -300, y: -120, w: 600, h: 240 });
    lay.nodes = {};
    this.layoutNodes();
  }
  nodeRect(id) {
    const n = this.nodes.get(id);
    return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
  }
  chipRect(chipId) {
    for (const n of this.nodes.values()) {
      const c = n.chips?.find((c2) => c2.id === chipId);
      if (c) return { x: n.x + c.x, y: n.y, w: c.w, h: n.h };
    }
    return null;
  }
  /** Any endpoint: a node, an account chip, or a session window. */
  endRect(id) {
    if (id.startsWith("win:")) {
      const key = id.slice(4);
      return this.host.liveWindows().find((w) => w.session.key === key)?.rect ?? null;
    }
    if (id.startsWith("acct:")) return this.chipRect(id);
    return this.nodeRect(id);
  }
  moveNode(id, x, y) {
    const n = this.nodes.get(id);
    if (!n) return;
    const lay = this.host.layout();
    if (n.kind === "custom") {
      const c = lay.custom?.[id];
      if (c) {
        c.x = x;
        c.y = y;
      }
      n.x = x;
      n.y = y;
    } else {
      lay.nodes ??= {};
      const laneX = lay.lanes?.x ?? 0;
      const W = this.laneRect.w;
      const rel = Math.max(12, Math.min(W - 12 - n.w, x - laneX));
      lay.nodes[id] = { x: rel };
      n.x = laneX + rel;
    }
  }
  // ---------- edges ----------
  computeEdges() {
    const lay = this.host.layout();
    const edges = [];
    for (const n of this.nodes.values()) if (n.kind === "device") edges.push({ a: n.id, b: "hub", kind: "device" });
    for (const { session } of this.host.liveWindows()) {
      const from = `win:${session.key}`;
      const chip = session.accountId ? `acct:${session.harness}:${session.accountId}` : void 0;
      if (chip && this.chipRect(chip)) edges.push({ a: from, b: chip, kind: "agent", state: session.state });
      else if (this.nodes.has(`agent:${session.harness}`))
        edges.push({ a: from, b: `agent:${session.harness}`, kind: "agent", state: session.state });
      if (session.machine && this.nodes.has(`machine:${session.machine}`)) {
        edges.push({ a: from, b: `machine:${session.machine}`, kind: "session", state: session.state });
      }
      if (session.repo) {
        const id = `repo:${repoParts(session.repo).short}`;
        if (this.nodes.has(id)) edges.push({ a: from, b: id, kind: "session", state: session.state });
      }
    }
    for (const l of lay.links ?? []) edges.push({ a: l.from, b: l.to, kind: "custom", id: l.id });
    return edges;
  }
  /** Mean x of the windows an endpoint connects to; nodes pack in that order. */
  barycenter(id) {
    const xs = [];
    for (const e of this.edges) {
      if (e.kind === "custom") continue;
      const other = e.b === id ? e.a : e.a === id ? e.b : void 0;
      if (!other) continue;
      const r = this.endRect(other);
      if (r) xs.push(r.x + r.w / 2);
    }
    if (id.startsWith("agent:")) {
      const n = this.nodes.get(id);
      for (const c of n?.chips ?? []) {
        const b = this.barycenter(c.id);
        if (Number.isFinite(b)) xs.push(b);
      }
    }
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY;
  }
  /** Lines and lanes from the current rects. Called from the frame when anything moved. */
  draw() {
    if (this.lanesEl.hidden) return;
    for (let i = 0; i < LANES.length; i++) {
      const lane = this.laneEls[i];
      const row = this.rows[i];
      lane.style.transform = `translate3d(${this.laneRect.x}px, ${row.y}px, 0)`;
      lane.style.width = `${this.laneRect.w}px`;
      lane.style.height = `${row.h}px`;
    }
    for (const n of this.nodes.values()) n.el.style.transform = `translate3d(${n.x}px, ${n.y}px, 0)`;
    const seen = /* @__PURE__ */ new Set();
    const trunks = /* @__PURE__ */ new Map();
    for (const e of this.edges) {
      const a = this.endRect(e.a);
      const b = this.endRect(e.b);
      if (!a || !b) continue;
      const key = `${e.a}|${e.b}`;
      seen.add(key);
      let d;
      if (e.kind === "custom") {
        d = `M${a.x + a.w / 2},${a.y + a.h / 2} L${b.x + b.w / 2},${b.y + b.h / 2}`;
      } else {
        const up = b.y + b.h <= a.y;
        const lane = this.laneOf(e.b);
        const row = lane >= 0 ? this.rows[lane] : null;
        const busY = row ? up ? row.y + row.h + BUS_GAP : row.y - BUS_GAP : up ? b.y + b.h + BUS_GAP : b.y - BUS_GAP;
        const dx = e.kind === "session" && e.b.startsWith("repo:") ? 5 : e.kind === "session" ? -5 : 0;
        const sx = a.x + a.w / 2 + dx;
        const sy = up ? a.y : a.y + a.h;
        const tx = b.x + b.w / 2;
        const ty = up ? b.y + b.h : b.y;
        d = orthoPath([
          [sx, sy],
          [sx, busY],
          [tx, busY]
        ]);
        const t = trunks.get(e.b);
        if (!t) trunks.set(e.b, { x: tx, busY, ty, up });
      }
      let rec = this.lineEls.get(key);
      if (!rec) {
        const line = svg("path", { class: `cv-edge cv-edge-${e.kind}`, "data-a": e.a, "data-b": e.b });
        if (e.state) line.dataset.state = e.state;
        let hit;
        if (e.kind === "custom" && e.id) {
          line.dataset.link = e.id;
          hit = svg("path", { class: "cv-edge-hit", "data-a": e.a, "data-b": e.b });
          hit.dataset.link = e.id;
        }
        rec = { line, hit, coords: "" };
        this.lineEls.set(key, rec);
        this.edgesG.append(line);
        if (hit) this.edgesG.append(hit);
      } else if (e.state && rec.line.dataset.state !== e.state) rec.line.dataset.state = e.state;
      if (rec.coords !== d) {
        rec.coords = d;
        rec.line.setAttribute("d", d);
        rec.hit?.setAttribute("d", d);
      }
      if (e.kind === "custom") setClass(rec.line, "is-selected", this.selected === e.id);
    }
    for (const [key, rec] of this.lineEls) {
      if (seen.has(key)) continue;
      rec.line.remove();
      rec.hit?.remove();
      this.lineEls.delete(key);
    }
    for (const [target, t] of trunks) {
      let el2 = this.trunkEls.get(target);
      if (!el2) {
        el2 = svg("path", { class: "cv-trunk", "data-b": target });
        this.trunkEls.set(target, el2);
        this.edgesG.append(el2);
      }
      const d = `M${t.x},${t.busY} L${t.x},${t.ty}`;
      if (el2.getAttribute("d") !== d) el2.setAttribute("d", d);
    }
    for (const [target, el2] of this.trunkEls) {
      if (trunks.has(target)) continue;
      el2.remove();
      this.trunkEls.delete(target);
    }
    if (this.focus) this.applyFocus();
  }
  lineEls = /* @__PURE__ */ new Map();
  trunkEls = /* @__PURE__ */ new Map();
  laneOf(id) {
    if (id.startsWith("acct:")) return 2;
    return this.nodes.get(id)?.lane ?? -1;
  }
  // ---------- hover focus ----------
  setFocus(id) {
    if (id === this.focus) return;
    this.focus = id;
    setClass(this.host.root, "is-focus", !!id);
    this.applyFocus();
  }
  applyFocus() {
    const id = this.focus;
    const lit = /* @__PURE__ */ new Set();
    const litTargets = /* @__PURE__ */ new Set();
    if (id) {
      lit.add(id);
      const group2 = id.startsWith("agent:") ? `acct:${id.slice(6)}:` : void 0;
      for (const e of this.edges) {
        const touches = e.a === id || e.b === id || group2 !== void 0 && (e.a.startsWith(group2) || e.b.startsWith(group2));
        if (!touches) continue;
        lit.add(e.a);
        lit.add(e.b);
        if (e.kind !== "custom") litTargets.add(e.b);
        if (e.a.startsWith("acct:")) lit.add(`agent:${e.a.split(":")[1]}`);
        if (e.b.startsWith("acct:")) lit.add(`agent:${e.b.split(":")[1]}`);
      }
    }
    const group = id?.startsWith("agent:") ? `acct:${id.slice(6)}:` : void 0;
    for (const rec of this.lineEls.values()) {
      const a = rec.line.dataset.a;
      const b = rec.line.dataset.b;
      const on = !!id && (a === id || b === id || group !== void 0 && (a.startsWith(group) || b.startsWith(group)));
      setClass(rec.line, "is-lit", on);
    }
    for (const [target, el2] of this.trunkEls) setClass(el2, "is-lit", litTargets.has(target));
    for (const n of this.nodes.values()) setClass(n.el, "is-lit", lit.has(n.id));
    for (const w of this.host.root.querySelectorAll(".cv-win")) {
      setClass(w, "is-lit", lit.has(`win:${w.dataset.key}`));
    }
  }
  // ---------- hand-drawn nodes and links ----------
  addCustom(x, y) {
    const lay = this.host.layout();
    lay.custom ??= {};
    const id = `c_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const spot = findFree({ x, y }, 140, NODE_H, this.host.taken(), 24);
    lay.custom[id] = { id, label: "", x: spot.x, y: spot.y };
    this.editing = id;
    this.build();
    this.layoutNodes();
    this.draw();
    this.select(id);
    this.edit(id);
    return id;
  }
  /** Inline edit of a custom node's label; an empty label on commit deletes it. */
  edit(id) {
    const n = this.nodes.get(id);
    if (n?.kind !== "custom") return;
    const l = n.el.querySelector(".cv-node-edit");
    this.editing = id;
    l.contentEditable = "true";
    n.el.classList.add("is-editing");
    l.focus();
    const range = document.createRange();
    range.selectNodeContents(l);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    const commit = () => {
      l.removeEventListener("blur", commit);
      l.removeEventListener("keydown", onKey);
      l.contentEditable = "false";
      n.el.classList.remove("is-editing");
      this.editing = void 0;
      const label = oneLine(l.textContent ?? "", 60);
      const lay = this.host.layout();
      if (!label) {
        delete lay.custom?.[id];
        lay.links = (lay.links ?? []).filter((k) => k.from !== id && k.to !== id);
        if (this.selected === id) this.selected = null;
      } else if (lay.custom?.[id]) {
        lay.custom[id].label = label;
      }
      this.build();
      this.layoutNodes();
      this.draw();
      this.host.save();
      this.host.request();
    };
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        l.blur();
      }
    };
    l.addEventListener("blur", commit);
    l.addEventListener("keydown", onKey);
  }
  get isEditing() {
    return !!this.editing;
  }
  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    for (const n of this.nodes.values()) setClass(n.el, "is-selected", n.id === id);
    this.draw();
  }
  /** Backspace: a hand-drawn node (with its links) or a hand-drawn link. */
  deleteSelected() {
    const id = this.selected;
    if (!id) return false;
    const lay = this.host.layout();
    if (lay.custom?.[id]) {
      delete lay.custom[id];
      lay.links = (lay.links ?? []).filter((k) => k.from !== id && k.to !== id);
    } else if (lay.links?.some((k) => k.id === id)) {
      lay.links = lay.links.filter((k) => k.id !== id);
    } else {
      return false;
    }
    this.selected = null;
    this.build();
    this.layoutNodes();
    this.draw();
    this.host.save();
    this.host.request();
    return true;
  }
  beginLink(from) {
    this.linkFrom = from;
    const r = this.endRect(from);
    if (!r) return;
    this.tempLine.setAttribute("x1", `${r.x + r.w / 2}`);
    this.tempLine.setAttribute("y1", `${r.y + r.h / 2}`);
    this.tempLine.setAttribute("x2", `${r.x + r.w / 2}`);
    this.tempLine.setAttribute("y2", `${r.y + r.h / 2}`);
    this.tempLine.style.display = "";
    this.host.root.classList.add("is-linking");
  }
  moveLink(wx, wy) {
    this.tempLine.setAttribute("x2", `${wx}`);
    this.tempLine.setAttribute("y2", `${wy}`);
  }
  endLink(to) {
    const from = this.linkFrom;
    this.linkFrom = void 0;
    this.tempLine.style.display = "none";
    this.host.root.classList.remove("is-linking");
    if (!from || !to || to === from) return;
    const lay = this.host.layout();
    lay.links ??= [];
    if (lay.links.some((k) => k.from === from && k.to === to || k.from === to && k.to === from)) return;
    const link = { id: `l_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, from, to };
    lay.links.push(link);
    this.edges = this.computeEdges();
    this.select(link.id);
    this.host.save();
    this.host.request();
  }
  // ---------- an agent dragged onto a machine ----------
  beginGhost(chipId, sx, sy) {
    let chip;
    for (const n of this.nodes.values()) chip = chip ?? n.chips?.find((c) => c.id === chipId);
    if (!chip) return;
    this.ghostChip = chip;
    this.ghost = el("div", "cv-ghost", chip.label);
    this.host.root.append(this.ghost);
    this.moveGhost(sx, sy);
    this.host.root.classList.add("is-ghosting");
  }
  moveGhost(sx, sy) {
    if (this.ghost) this.ghost.style.transform = `translate3d(${sx + 12}px, ${sy - 14}px, 0)`;
  }
  endGhost(targetId) {
    const chip = this.ghostChip;
    this.ghost?.remove();
    this.ghost = void 0;
    this.ghostChip = void 0;
    this.host.root.classList.remove("is-ghosting");
    const target = targetId ? this.nodes.get(targetId) : void 0;
    if (!chip || !target || target.kind !== "machine") return;
    this.openPopover(target, chip);
  }
  /** The small start form under a machine node. */
  openPopover(machine, chip) {
    this.closePopover();
    const api = this.host.api;
    const pop = el("div", "cv-pop");
    pop.dataset.machine = machine.id;
    const m = this.host.snapshot().machines.get(machine.machine ?? "");
    const av = api.control && machine.machineId ? api.control.availability({ machineId: machine.machineId }) : { ok: false, reason: "control is not available" };
    pop.append(el("div", "cv-pop-t", `Start ${harnessShort(chip.harness)} on ${machine.label}`));
    pop.append(el("div", "cv-pop-s", chip.label));
    const folders = m?.control?.folders ?? [];
    const sel = el("select", "cv-pop-folder");
    sel.setAttribute("aria-label", "Folder");
    for (const f of folders) {
      const o = el("option", void 0, f);
      o.value = f;
      sel.append(o);
    }
    if (!folders.length) {
      const o = el("option", void 0, "no folders allowed");
      o.value = "";
      sel.append(o);
    }
    const input = el("input", "cv-pop-text");
    input.type = "text";
    input.placeholder = "First message";
    input.setAttribute("aria-label", "First message");
    const row = el("div", "cv-pop-row");
    const start = el("button", "cv-pop-start", "Start");
    start.type = "button";
    const cancel = el("button", "cv-pop-cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => this.closePopover());
    const reason = el("div", "cv-pop-reason", av.ok ? "" : av.reason ?? "");
    reason.hidden = av.ok;
    const ready = () => av.ok && !!sel.value && !!input.value.trim();
    const sync = () => {
      start.disabled = !ready();
    };
    input.addEventListener("input", sync);
    sel.addEventListener("change", sync);
    const go = async () => {
      if (!ready() || !api.control || !machine.machineId) return;
      start.disabled = true;
      setText(reason, "sending\u2026");
      reason.hidden = false;
      try {
        const a = await api.control.start(machine.machineId, {
          harness: chip.harness,
          cwd: sel.value,
          text: input.value.trim()
        });
        this.host.onStarted(a.session, machine.id);
        this.closePopover();
      } catch (e) {
        setText(reason, e instanceof Error ? e.message : String(e));
        reason.classList.add("is-err");
        start.disabled = false;
      }
    };
    start.addEventListener("click", () => void go());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void go();
      if (e.key === "Escape") this.closePopover();
    });
    sel.addEventListener("keydown", (e) => e.stopPropagation());
    row.append(start, cancel);
    pop.append(sel, input, row, reason);
    this.host.root.append(pop);
    const p = this.host.toScreen(machine.x, machine.y + machine.h);
    const rw = pop.offsetWidth;
    const rh = pop.offsetHeight;
    const rootW = this.host.root.clientWidth;
    const rootH = this.host.root.clientHeight;
    const x = Math.max(8, Math.min(rootW - rw - 8, p.x));
    const y = p.y + 8 + rh > rootH - 8 ? Math.max(8, p.y - rh - machine.h * 1 - 8) : p.y + 8;
    pop.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.pop = pop;
    sync();
    if (av.ok) input.focus();
  }
  closePopover() {
    this.pop?.remove();
    this.pop = void 0;
  }
  get hasPopover() {
    return !!this.pop;
  }
  destroy() {
    this.closePopover();
    this.ghost?.remove();
    this.lanesEl.remove();
    this.nodesEl.remove();
    this.customEl.remove();
    this.edgesG.remove();
    this.tempLine.remove();
  }
};
function orthoPath(pts, r = 6) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    if (rr < 0.5 || inLen === 0 || outLen === 0) {
      d += ` L${x},${y}`;
      continue;
    }
    const ux = (x - px) / inLen;
    const uy = (y - py) / inLen;
    const vx = (nx - x) / outLen;
    const vy = (ny - y) / outLen;
    d += ` L${x - ux * rr},${y - uy * rr} Q${x},${y} ${x + vx * rr},${y + vy * rr}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  d += ` L${lx},${ly}`;
  return d;
}
function harnessShort(h) {
  return h.replace(/-code$|-cli$/, "");
}
function repoParts(repo) {
  const noScheme = repo.replace(/^[a-z]+:\/\//i, "").replace(/\.git$/, "");
  const parts = noScheme.split("/").filter(Boolean);
  if (parts.length >= 3) return { short: parts.slice(-2).join("/"), host: parts[0] };
  return { short: noScheme, host: "" };
}

// src/events.ts
var str = (v) => typeof v === "string" ? v : v === void 0 || v === null ? "" : String(v);
var num = (v) => typeof v === "number" ? v : void 0;
function durShort(msTotal) {
  if (msTotal === void 0 || Number.isNaN(msTotal)) return "";
  if (msTotal < 1e3) return `${Math.round(msTotal)} ms`;
  if (msTotal < 6e4) return `${(msTotal / 1e3).toFixed(msTotal < 1e4 ? 1 : 0)} s`;
  const m = Math.floor(msTotal / 6e4);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
function eventLine(e) {
  const d = e.data ?? {};
  switch (e.type) {
    case "tool.started":
      return { kind: "tool", label: str(d.tool), text: d.agent_id ? "subagent" : inputHint(d.input) };
    case "tool.ended": {
      const ok = d.ok !== false;
      const bits = [ok ? "ok" : "error"];
      if (num(d.ms) !== void 0) bits.push(durShort(num(d.ms)));
      if (d.error) bits.push(oneLine(str(d.error), 80));
      return { kind: "tool", label: str(d.tool), text: bits.join(" \xB7 "), err: !ok };
    }
    case "turn.started":
      return {
        kind: "turn",
        label: "turn",
        text: d.prompt_chars !== void 0 ? `prompt \xB7 ${str(d.prompt_chars)} chars` : "prompt"
      };
    case "turn.ended": {
      const bits = [str(d.reason) || "stop"];
      if (num(d.ms) !== void 0) bits.push(durShort(num(d.ms)));
      if (d.error) bits.push(str(d.error));
      return { kind: "turn", label: "turn", text: bits.join(" \xB7 "), err: !!d.error };
    }
    case "turn.transcript": {
      const a = str(d.assistant);
      return a ? { kind: "text", label: "assistant", text: oneLine(a, 600), prose: true } : null;
    }
    case "turn.progress":
      return null;
    case "files.changed": {
      const paths = Array.isArray(d.paths) ? d.paths.map(str) : [];
      return {
        kind: "other",
        label: "files",
        text: paths.length <= 3 ? paths.join(", ") : `${paths.slice(0, 3).join(", ")} +${paths.length - 3}`
      };
    }
    case "attention.needed":
      return {
        kind: "attention",
        label: str(d.kind) || "attention",
        text: [str(d.tool), oneLine(str(d.message), 140)].filter(Boolean).join(" \xB7 ")
      };
    case "attention.cleared":
      return { kind: "attention", label: "cleared", text: str(d.how) || "" };
    case "session.started":
      return { kind: "session", label: "session", text: `started \xB7 ${str(d.source) || "unknown"}` };
    case "session.ended":
      return { kind: "session", label: "session", text: `ended \xB7 ${str(d.reason) || "other"}` };
    case "subagent.started":
      return { kind: "other", label: "subagent", text: `${str(d.agent_type) || "subagent"} started` };
    case "subagent.ended":
      return { kind: "other", label: "subagent", text: `${str(d.agent_type) || "subagent"} ended` };
    case "context.compacted":
      return { kind: "other", label: "context", text: `compacted \xB7 ${str(d.trigger) || "auto"}` };
    case "session.heartbeat":
    case "native":
      return null;
    default:
      return { kind: "other", label: e.type, text: Object.keys(d).slice(0, 3).join(", ") };
  }
}
function inputHint(input) {
  if (!input || typeof input !== "object") return "";
  const i = input;
  for (const k of ["command", "cmd", "file_path", "path", "pattern", "query", "url", "description", "prompt"]) {
    const v = i[k];
    if (typeof v === "string" && v.trim()) return oneLine(v, 90);
  }
  return "";
}
function clock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// src/detail.ts
var MAX_ROWS = 400;
var Detail = class {
  constructor(api, key) {
    this.api = api;
    this.key = key;
    this.el = el("div", "cv-detail");
    this.list = el("div", "cv-detail-list");
    this.list.setAttribute("role", "log");
    this.el.append(this.list);
    void this.load();
  }
  el;
  list;
  off;
  lastSeq = -1;
  rows = 0;
  dead = false;
  async load() {
    const status = el("div", "cv-detail-status", "loading\u2026");
    this.list.append(status);
    try {
      const d = await this.api.fetch.session(this.key, { limit: 200 });
      if (this.dead) return;
      status.remove();
      for (const e of d.events) this.push(e, false);
      if (!this.rows) this.list.append(el("div", "cv-detail-status", "nothing yet"));
      this.list.scrollTop = this.list.scrollHeight;
    } catch (err) {
      status.textContent = `could not load: ${err.message ?? err}`;
    }
    this.off = this.api.onEvent((e) => {
      if (`${e.harness.name}:${e.session.id}` === this.key) this.push(e, true);
    });
  }
  push(e, live) {
    if (e.session.seq <= this.lastSeq) return;
    this.lastSeq = e.session.seq;
    const line = eventLine(e);
    if (!line) return;
    const pinned = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 24;
    const row = el("div", `cv-row cv-row-${line.kind}${line.err ? " is-err" : ""}${line.prose ? " is-prose" : ""}`);
    row.append(
      el("span", "cv-row-t", clock(e.time)),
      el("span", "cv-row-l", line.label),
      el("span", "cv-row-x", line.text)
    );
    if (this.rows === 0) this.list.querySelector(".cv-detail-status")?.remove();
    this.list.append(row);
    this.rows++;
    while (this.rows > MAX_ROWS && this.list.firstElementChild) {
      this.list.firstElementChild.remove();
      this.rows--;
    }
    if (live && pinned) this.list.scrollTop = this.list.scrollHeight;
  }
  destroy() {
    this.dead = true;
    this.off?.();
    this.el.remove();
  }
};

// src/window.ts
var ATTENTION_LABEL = {
  permission: "permission",
  question: "question",
  elicitation: "input wanted",
  idle: "idle prompt",
  error: "error"
};
var KIND_LABEL = {
  prompt: "prompt",
  "permission.answer": "answer",
  cancel: "cancel",
  start: "start",
  "key.add": "trust a device"
};
var ACTS_SHOWN = 1;
var ACTS_EXPANDED = 3;
var WinView = class {
  constructor(api, session, hooks) {
    this.api = api;
    this.hooks = hooks;
    this.key = session.key;
    this.session = session;
    const sub = !!session.parentId;
    this.el = el("div", `cv-win${sub ? " is-sub" : ""}`);
    this.el.dataset.key = session.key;
    this.el.tabIndex = 0;
    this.el.setAttribute("role", "group");
    this.bar = el("div", "cv-win-bar");
    this.dot = el("span", "cv-dot");
    this.title = el("span", "cv-win-title");
    this.meta = el("span", "cv-win-meta");
    const open = el("button", "cv-win-open", "\u2192");
    open.type = "button";
    open.title = "Open the session";
    open.setAttribute("aria-label", "Open the session");
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onOpen();
    });
    this.latest = el("span", "cv-win-latest", "latest");
    this.latest.hidden = true;
    const close = el("button", "cv-win-close", "\xD7");
    close.type = "button";
    close.title = "Hide until it changes state";
    close.setAttribute("aria-label", "Hide until it changes state");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onClose();
    });
    this.bar.append(this.dot, this.title, this.meta, this.latest, open, close);
    this.body = el("div", "cv-win-body");
    this.now = el("div", "cv-win-now");
    const nowLabel = el("span", "cv-win-now-l");
    this.nowElapsed = el("span", "cv-win-now-t");
    this.cancel = el("a", "cv-link cv-win-cancel", "Cancel");
    this.cancel.href = "#";
    this.cancel.title = "Stop the running turn";
    this.cancel.hidden = true;
    this.cancel.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.run(() => this.api.control.cancel(this.key));
    });
    this.now.append(nowLabel, this.nowElapsed, this.cancel);
    this.text = el("div", "cv-win-text");
    this.att = el("div", "cv-win-att");
    this.attText = el("span", "cv-win-att-x");
    this.allow = el("a", "cv-link", "Allow");
    this.allow.href = "#";
    this.deny = el("a", "cv-link", "Deny");
    this.deny.href = "#";
    for (const [a, decision] of [
      [this.allow, "allow"],
      [this.deny, "deny"]
    ]) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.answer(decision);
      });
    }
    const acts = el("span", "cv-win-att-a");
    acts.append(this.allow, this.deny);
    this.att.append(this.attText, acts);
    this.ctl = el("div", "cv-win-ctl");
    this.ctlRow = el("div", "cv-ctl-row");
    this.input = el("input", "cv-ctl-input");
    this.input.type = "text";
    this.input.placeholder = "Prompt\u2026 Enter sends";
    this.input.autocomplete = "off";
    this.input.setAttribute("aria-label", "Prompt for this session");
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.input.value.trim()) {
        e.preventDefault();
        const text = this.input.value.trim();
        void this.run(async () => {
          const a = await this.api.control.send(this.key, text);
          this.input.value = "";
          return a;
        });
      }
      if (e.key === "Escape") {
        this.input.blur();
        this.el.focus({ preventScroll: true });
      }
      e.stopPropagation();
    });
    this.ctlRow.append(this.input);
    this.reason = el("div", "cv-ctl-reason");
    this.acts = el("div", "cv-ctl-acts");
    this.ctl.append(this.ctlRow, this.reason, this.acts);
    this.ctl.hidden = true;
    this.body.append(this.now, this.text, this.att, this.ctl);
    this.foot = el("div", "cv-win-foot");
    this.footLeft = el("span");
    this.footRight = el("span");
    this.kids = el("button", "cv-win-kids");
    this.kids.type = "button";
    this.kids.hidden = true;
    this.kids.title = "Finished subagents";
    this.kids.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hooks.onToggleDone();
    });
    this.foot.append(this.footLeft, this.kids, this.footRight);
    const resize = el("div", "cv-win-resize");
    resize.setAttribute("aria-hidden", "true");
    this.el.append(this.bar, this.body, this.foot, resize);
    this.update(session, Date.now(), [], 0, false);
  }
  el;
  key;
  z = 0;
  session;
  detail;
  sig = "";
  bar;
  dot;
  title;
  meta;
  body;
  now;
  nowElapsed;
  cancel;
  text;
  att;
  attText;
  allow;
  deny;
  ctl;
  ctlRow;
  input;
  reason;
  acts;
  foot;
  footLeft;
  footRight;
  kids;
  latest;
  ageBucket = -1;
  /** What the elapsed numeral counts from, if anything. */
  since;
  sincePrefix = "";
  canControl = false;
  busy = false;
  error = "";
  update(s, now, activities, doneKids, showingDone) {
    this.session = s;
    this.lastActs = activities;
    this.lastDone = doneKids;
    this.lastShowing = showingDone;
    const att = s.openAttentions[0];
    const prog = s.progress?.assistant ?? "";
    const control = this.api.control;
    const av = control && s.state !== "done" ? control.availability({ session: s.key }) : null;
    this.canControl = !!av?.ok;
    const acts = activities.slice(0, this.expanded ? ACTS_EXPANDED : ACTS_SHOWN);
    const sig = [
      s.state,
      s.title,
      s.machine,
      s.repo,
      s.branch,
      s.currentTool?.tool,
      s.currentTool?.since,
      s.currentTurn?.since,
      s.stateSince,
      s.endedAt,
      att?.attentionId,
      att?.message,
      prog.length,
      s.progress?.at,
      s.lastAssistant,
      s.lastUser,
      s.counts.tools,
      s.counts.toolErrors,
      s.counts.filesChanged,
      s.counts.turns,
      s.counts.subagents,
      s.model,
      av ? `${av.ok}:${av.reason ?? ""}` : "-",
      acts.map((a) => `${a.id}:${a.outcome ?? ""}:${a.reply?.length ?? ""}`).join(","),
      doneKids,
      showingDone,
      this.busy,
      this.error
    ].join("");
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.dataset.state = s.state;
    setClass(this.el, "is-needs", s.state === "needs_you");
    setClass(this.el, "is-muted", s.state === "stale" || s.state === "idle" || s.state === "done");
    setClass(this.el, "is-done", s.state === "done");
    setText(this.title, this.api.format.title(s));
    this.title.title = this.api.format.title(s);
    const rb = this.api.format.repoBranch(s);
    setText(this.meta, [s.machine, rb].filter(Boolean).join(" \xB7 "));
    const label = this.now.firstElementChild;
    this.since = void 0;
    this.sincePrefix = "";
    let nowText = "";
    let nowCls = "";
    if (s.state === "needs_you" && att) {
      nowText = `${ATTENTION_LABEL[att.kind] ?? att.kind}${att.tool ? ` \xB7 ${att.tool}` : ""}`;
      nowCls = "is-needs";
      this.since = ms(att.at);
      this.sincePrefix = "waiting ";
    } else if (s.state === "working") {
      if (s.currentTool) {
        nowText = s.currentTool.tool;
        nowCls = "is-tool";
        this.since = ms(s.currentTool.since);
      } else if (s.progress && now - ms(s.progress.at) < 4e3) {
        nowText = "writing";
        nowCls = "is-writing";
      } else {
        nowText = "thinking";
        nowCls = "is-writing";
        this.since = s.currentTurn ? ms(s.currentTurn.since) : void 0;
      }
    } else if (s.state === "stale") {
      nowText = "silent";
      this.since = ms(s.lastAt);
      this.sincePrefix = "for ";
    } else if (s.state === "idle") {
      nowText = "idle";
      this.since = ms(s.stateSince);
      this.sincePrefix = "for ";
    } else {
      const ran = ms(s.endedAt ?? s.lastAt) - ms(s.startedAt);
      nowText = `done \xB7 ${s.counts.tools} tool${s.counts.tools === 1 ? "" : "s"}${ran > 0 ? ` \xB7 ${durShort(ran)}` : ""}`;
      this.since = void 0;
    }
    setText(label, nowText);
    this.now.className = `cv-win-now ${nowCls}`;
    this.cancel.hidden = !(this.canControl && s.state === "working" && !s.parentId);
    this.tick(now);
    let text = "";
    let textCls = "cv-win-text";
    if (s.state === "working" && prog) {
      text = tail(prog, 260);
      textCls += " is-live";
    } else if (s.lastAssistant) {
      text = oneLine(s.lastAssistant, 260);
    } else if (s.progress?.user || s.lastUser) {
      text = oneLine(s.progress?.user ?? s.lastUser, 260);
      textCls += " is-user";
    }
    setText(this.text, text);
    this.text.className = textCls;
    this.text.hidden = !text;
    if (att) {
      setText(this.attText, oneLine(att.message ?? ATTENTION_LABEL[att.kind] ?? att.kind, 160));
      this.att.hidden = false;
      const ask = att.kind === "permission";
      setClass(this.att, "is-ask", ask);
      setClass(this.att, "is-local", ask && this.canControl);
      const title = ask && this.canControl ? "Answer from here" : "Answer on the session page";
      this.allow.title = title;
      this.deny.title = title;
    } else {
      this.att.hidden = true;
    }
    if (control && !s.parentId && s.state !== "done") {
      this.ctl.hidden = false;
      this.ctlRow.hidden = !this.canControl;
      this.input.disabled = this.busy;
      const reason = this.error || (av && !av.ok ? av.reason || "control is not available" : "");
      setText(this.reason, reason);
      this.reason.hidden = !reason;
      setClass(this.reason, "is-err", !!this.error);
      this.renderActs(acts, s, now);
    } else {
      this.ctl.hidden = true;
    }
    const c = s.counts;
    const bits = [`${c.tools} tool${c.tools === 1 ? "" : "s"}`];
    if (c.toolErrors) bits.push(`${c.toolErrors} err`);
    if (c.filesChanged) bits.push(`${c.filesChanged} file${c.filesChanged === 1 ? "" : "s"}`);
    if (c.turns) bits.push(`${c.turns} turn${c.turns === 1 ? "" : "s"}`);
    const liveKids = c.subagents - doneKids;
    if (liveKids > 0) bits.push(`${liveKids} sub`);
    setText(this.footLeft, bits.join(" \xB7 "));
    this.kids.hidden = doneKids === 0;
    setText(this.kids, `${doneKids} done`);
    setClass(this.kids, "is-on", showingDone);
    this.kids.setAttribute("aria-expanded", String(showingDone));
    setText(this.footRight, [this.api.format.monogram(s.harness), modelShort(s.model)].filter(Boolean).join(" \xB7 "));
  }
  renderActs(acts, s, now) {
    const machine = s.machine ?? "the machine";
    this.acts.replaceChildren(
      ...acts.map((a) => {
        const state = shownState(a);
        const row = el("div", `cv-act is-${state}`);
        row.dataset.message = a.id;
        row.dataset.outcome = state;
        const head = el("div", "cv-act-head");
        head.append(
          el("span", "cv-act-kind", KIND_LABEL[a.kind] ?? a.kind),
          el("span", "cv-act-text", a.text ? oneLine(a.text, 80) : ""),
          el("span", "cv-act-ago", this.api.format.ago(a.ackedAt ?? a.takenAt ?? a.at, now))
        );
        row.append(head, el("div", `cv-act-state${isFinal(a) ? "" : " is-live"}`, outcomeWords(a, machine)));
        if (a.reply) row.append(el("div", "cv-act-reply", tail(a.reply, 200)));
        return row;
      })
    );
    this.acts.hidden = acts.length === 0;
  }
  /** The most recently touched session on the canvas. */
  setLatest(on) {
    if (this.latest.hidden === !on) return;
    this.latest.hidden = !on;
    setClass(this.el, "is-latest", on);
  }
  /** Borders and title fade with age on a log scale; the attribute changes only when
   *  the bucket does, so a tick costs nothing when nothing moved. */
  setAge(bucket) {
    if (bucket === this.ageBucket) return;
    this.ageBucket = bucket;
    this.el.dataset.age = String(bucket);
  }
  /** Once a second: the elapsed numeral beside the current tool or wait. */
  tick(now) {
    if (this.since === void 0 || Number.isNaN(this.since)) {
      setText(this.nowElapsed, "");
      return;
    }
    const d = Math.max(0, now - this.since);
    setText(this.nowElapsed, d < 1500 ? "" : `${this.sincePrefix}${durShort(d)}`);
  }
  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.sig = "";
    this.refresh();
    try {
      await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      this.error = m.startsWith("not sent") ? m : `not sent \xB7 ${m}`;
    } finally {
      this.busy = false;
      this.sig = "";
      this.refresh();
    }
  }
  /** Re-render from the last session with the control state changed (the canvas
   *  re-updates with fresh activities on the next snapshot anyway). */
  refresh() {
    this.update(this.session, Date.now(), this.lastActs, this.lastDone, this.lastShowing);
  }
  lastActs = [];
  lastDone = 0;
  lastShowing = false;
  /** Allow or deny the open permission: from here when the host carries it, else on the page. */
  answer(decision) {
    const att = this.session.openAttentions[0];
    if (!att) return;
    if (att.kind === "permission" && this.canControl && this.api.control) {
      return this.run(() => this.api.control.answer(this.key, att.attentionId, decision));
    }
    this.hooks.onOpen();
  }
  /** Enter on a focused window: the prompt line, when there is one. */
  focusPrompt() {
    if (this.ctl.hidden || this.ctlRow.hidden || this.input.disabled) return false;
    this.input.focus();
    return true;
  }
  setExpanded(on) {
    setClass(this.el, "is-expanded", on);
    if (on && !this.detail) {
      this.detail = new Detail(this.api, this.key);
      this.body.append(this.detail.el);
    } else if (!on && this.detail) {
      this.detail.destroy();
      this.detail = void 0;
    }
  }
  get expanded() {
    return !!this.detail;
  }
  destroy() {
    this.detail?.destroy();
    this.el.remove();
  }
};
function tail(s, max) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `\u2026${t.slice(t.length - max + 1)}` : t;
}
function modelShort(model) {
  if (!model) return "";
  let m = model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  m = m.replace(/(\d)-(\d)/g, "$1.$2");
  return m.replace(/-/g, " ");
}
function shownState(a) {
  if (a.outcome === "taken" && a.reply !== void 0) return "progress";
  return a.outcome ?? "queued";
}
var isFinal = (a) => a.outcome === "delivered" || a.outcome === "expired" || a.outcome === "unsupported" || a.outcome === "failed" || a.outcome === "refused";
function outcomeWords(a, machine) {
  const mode = a.mode ? ` \xB7 ${a.mode}` : "";
  switch (shownState(a)) {
    case "queued":
      return `queued \xB7 waiting for ${machine} to take it`;
    case "taken":
      return `taken \xB7 ${machine} is delivering it${mode}`;
    case "progress":
      return `working \xB7 ${machine} is answering${mode}`;
    case "delivered":
      return `delivered${mode}`;
    case "expired":
      return `expired \xB7 ${a.detail ?? "nobody took it in time"}`;
    case "unsupported":
      return `unsupported \xB7 ${machine} has no way to ${KIND_LABEL[a.kind] ?? a.kind} on this harness`;
    case "failed":
      return `failed \xB7 ${a.detail ?? "the path errored"}`;
    case "refused":
      return `refused \xB7 ${a.code ? a.code.replace(/_/g, " ") : a.detail ?? ""}`;
    default:
      return String(a.outcome);
  }
}

// src/index.ts
var VIEWPORT_KEY = "viewport";
var MAP_LOCAL_KEY = "map";
var COLOUR_LOCAL_KEY = "colour";
var LEGEND_SEEN_KEY = "legendSeen";
var LINES_LOCAL_KEY = "lines";
var LINES_MODES = ["hovered", "all", "none"];
var AGE_STEPS_MS = [2 * 6e4, 15 * 6e4, 36e5, 6 * 36e5];
var SHELF_MAX = 48;
var Z_NEEDS = 1e5;
var Canvas = class {
  constructor(container, api) {
    this.api = api;
    this.snapshot = api.state.get();
    this.root = el("div", "spcv");
    this.root.tabIndex = 0;
    this.root.dataset.scheme = this.snapshot.scheme;
    if (isTouchLike()) this.root.classList.add("is-touch");
    this.world = el("div", "cv-world");
    this.zonesEl = el("div", "cv-zones");
    this.tethers = svg("svg", { class: "cv-tethers", "aria-hidden": "true" });
    this.treeG = svg("g", { class: "cv-tree" });
    this.tethers.append(this.treeG);
    this.winsEl = el("div", "cv-wins");
    this.map = new MapLayer(this.mapHost());
    this.world.append(this.zonesEl, this.map.lanesEl, this.tethers, this.map.nodesEl, this.winsEl, this.map.customEl);
    const hud = el("div", "cv-hud");
    const left = el("div", "cv-hud-l");
    this.search = el("input", "cv-search");
    this.search.type = "search";
    this.search.placeholder = "Find  /";
    this.search.setAttribute("aria-label", "Find sessions");
    this.search.autocomplete = "off";
    this.search.addEventListener("input", () => this.setQuery(this.search.value));
    left.append(this.search);
    const btn = (label, title, fn) => {
      const b = el("button", "cv-btn", label);
      b.type = "button";
      b.title = title;
      b.addEventListener("click", fn);
      left.append(b);
      return b;
    };
    btn("Tidy", "Arrange by state", () => this.tidy());
    btn("Fit", "Zoom to show everything (0)", () => this.fit());
    this.zonesBtn = btn("Zones", "Show machines as regions", () => this.toggleZones());
    this.mapBtn = btn("Map", "Devices, agents, machines and repos around the sessions", () => this.toggleMap());
    this.linesBtn = btn("Lines", "Which lines the map draws: hovered \xB7 all \xB7 none", () => this.cycleLines());
    this.linesBtn.classList.add("cv-lines");
    this.colourBtn = btn("Colour", "Colour windows by state (? explains)", () => this.toggleColour());
    const add = btn("+", "Add a node of your own", () => this.addCustomNode());
    add.classList.add("cv-btn-add");
    add.setAttribute("aria-label", "Add a node");
    btn("Reset", "Forget the layout", () => this.reset());
    const right = el("div", "cv-hud-r");
    this.conn = el("span", "cv-conn");
    this.zoomLabel = el("button", "cv-zoom", "100%");
    this.zoomLabel.type = "button";
    this.zoomLabel.title = "Zoom to 100%";
    this.zoomLabel.addEventListener("click", () => this.zoomTo(1));
    right.append(this.conn, this.zoomLabel);
    hud.append(left, right);
    this.status = el("div", "cv-status");
    this.status.setAttribute("aria-live", "polite");
    this.legend = el("div", "cv-legend");
    this.legend.hidden = true;
    const swatch = (cls, text) => {
      const item = el("span", "cv-legend-i");
      item.append(el("span", `cv-legend-s ${cls}`), document.createTextNode(text));
      return item;
    };
    const closeLegend = el("button", "cv-legend-x", "\xD7");
    closeLegend.type = "button";
    closeLegend.setAttribute("aria-label", "Hide the legend");
    closeLegend.addEventListener("click", () => this.showLegend(false));
    this.legend.append(
      swatch("is-working", "working"),
      swatch("is-needs", "needs you"),
      swatch("is-stale", "stale"),
      swatch("is-idle", "idle \xB7 done"),
      el("span", "cv-legend-t", "borders fade with age \xB7 the latest is marked"),
      closeLegend
    );
    this.tray = el("div", "cv-tray");
    this.shelf = el("div", "cv-shelf");
    this.shelfBtn = el("button", "cv-shelf-btn");
    this.shelfBtn.type = "button";
    this.shelfBtn.addEventListener("click", () => {
      this.layout.shelfOpen = !this.layout.shelfOpen;
      this.renderShelf();
      this.save();
    });
    this.shelfTiles = el("div", "cv-shelf-tiles");
    this.shelf.append(this.shelfBtn, this.shelfTiles);
    this.minimap = el("canvas", "cv-minimap");
    this.minimap.title = "Click to jump";
    this.minimap.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.jumpFromMinimap(e);
    });
    this.root.append(this.world, hud, this.legend, this.status, this.tray, this.shelf, this.minimap);
    container.append(this.root);
    if (this.root.clientHeight < 160) {
      const top = this.root.getBoundingClientRect().top;
      this.root.style.height = `calc(100vh - ${Math.max(0, top)}px)`;
    }
    this.measure();
    this.ro = new ResizeObserver(() => {
      this.measure();
      this.dirtyVp = true;
      this.request();
    });
    this.ro.observe(this.root);
    this.unsubs.push(attachInput(this));
    this.unsubs.push(api.state.subscribe((s) => this.onSnapshot(s)));
    this.ticker = setInterval(() => this.tick(), 1e3);
    void this.load();
  }
  root;
  world;
  zonesEl;
  tethers;
  winsEl;
  search;
  zoomLabel;
  conn;
  zonesBtn;
  mapBtn;
  colourBtn;
  linesBtn;
  legend;
  treeG;
  map;
  /** Sessions a start named, waiting to appear by their machine's node. */
  pendingStart = /* @__PURE__ */ new Map();
  tray;
  shelf;
  shelfBtn;
  shelfTiles;
  minimap;
  status;
  layout = emptyLayout();
  view = { x: 0, y: 0, k: 1 };
  size = { w: 0, h: 0 };
  views = /* @__PURE__ */ new Map();
  zoneEls = /* @__PURE__ */ new Map();
  snapshot;
  zTop = 1;
  query = "";
  dirtyVp = true;
  dirtyWins = /* @__PURE__ */ new Set();
  dirtyAll = true;
  frame = 0;
  tween;
  leaving = /* @__PURE__ */ new Set();
  unsubs = [];
  ticker;
  ro;
  ready = false;
  motion = !reducedMotion();
  // ---------- lifecycle ----------
  async load() {
    let stored = null;
    try {
      stored = await this.api.storage.get();
      if (stored && stored.v === 1 && stored.windows) this.layout = { ...emptyLayout(), ...stored };
    } catch {
    }
    const vp = this.api.local.get(VIEWPORT_KEY);
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && Number.isFinite(vp.k)) {
      this.view = { x: vp.x, y: vp.y, k: clamp(vp.k, ZOOM_MIN, ZOOM_MAX) };
    }
    this.ready = true;
    setClass(this.zonesBtn, "is-on", this.layout.zonesOn);
    this.applyColour();
    this.applyLines();
    const fresh = !stored || Object.keys(this.layout.windows).length === 0;
    this.sync(this.api.state.get(), true);
    if (fresh && this.narrow) this.tidy(false);
    this.applyMapOn();
    if (!vp) this.fit(false);
    this.dirtyVp = true;
    this.request();
  }
  destroy() {
    for (const u of this.unsubs) u();
    if (this.ticker) clearInterval(this.ticker);
    this.ro?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.save.flush();
    this.saveVp.flush();
    for (const v of this.views.values()) v.destroy();
    this.map.destroy();
    this.root.remove();
  }
  measure() {
    this.size = { w: this.root.clientWidth, h: this.root.clientHeight };
    setClass(this.root, "is-narrow", this.size.w < 600);
  }
  /** A phone: windows stack in one column and Fit fits the width. */
  get narrow() {
    return this.size.w < 600;
  }
  save = debounce(400, () => {
    void this.api.storage.set(this.layout).catch(() => {
    });
  });
  saveVp = debounce(250, () => {
    this.api.local.set(VIEWPORT_KEY, this.view);
  });
  // ---------- state ----------
  onSnapshot(s) {
    const schemeChanged = s.scheme !== this.snapshot.scheme;
    this.snapshot = s;
    if (schemeChanged) {
      this.root.dataset.scheme = s.scheme;
      this.dirtyVp = true;
      this.request();
    }
    if (this.ready) this.sync(s, false);
  }
  sync(s, initial) {
    const now = Date.now();
    setText(this.conn, s.connection === "live" ? "" : s.connection);
    setClass(this.conn, "is-off", s.connection !== "live");
    let placed = false;
    let zChanged = false;
    const live = [];
    const doneKids = /* @__PURE__ */ new Map();
    for (const sess of s.sessions.values()) {
      if (sess.parentId && sess.state === "done") doneKids.set(sess.parentId, (doneKids.get(sess.parentId) ?? 0) + 1);
    }
    const acts = /* @__PURE__ */ new Map();
    for (const a of s.control) {
      if (!a.session) continue;
      const list = acts.get(a.session) ?? [];
      list.push(a);
      acts.set(a.session, list);
    }
    const showing = (sess) => {
      if (!sess.parentId) return false;
      const parent = s.sessions.get(`${sess.harness}:${sess.parentId}`);
      return !!parent && !!this.layout.showDone?.[parent.key] && this.views.has(parent.key);
    };
    for (const sess of s.sessions.values()) {
      const key = sess.key;
      const pos = this.layout.windows[key];
      if (sess.state === "done" && !showing(sess)) {
        const v = this.views.get(key);
        if (v) this.leave(v);
        continue;
      }
      if (sess.state !== "done") live.push(sess);
      if (pos?.hidden && pos.hidden !== sess.state) {
        delete pos.hidden;
        placed = true;
      }
      if (pos?.hidden) {
        const v = this.views.get(key);
        if (v) this.dropView(v);
        continue;
      }
      let view = this.views.get(key);
      if (!view) {
        if (!pos) {
          this.layout.windows[key] = this.place(sess);
          placed = true;
        }
        view = this.addView(sess, !initial && this.motion);
        zChanged = true;
      } else {
        const before = view.session.state;
        view.update(sess, now, acts.get(key) ?? [], doneKids.get(sess.id) ?? 0, !!this.layout.showDone?.[key]);
        if (before !== sess.state) zChanged = true;
      }
      const p = this.layout.windows[key];
      if (p?.expanded && !view.expanded) view.setExpanded(true);
      this.dirtyWins.add(key);
    }
    for (const [key, v] of this.views) {
      if (!s.sessions.has(key)) {
        this.dropView(v);
        delete this.layout.windows[key];
        placed = true;
      }
    }
    for (const key of Object.keys(this.layout.windows)) {
      if (!s.sessions.has(key)) {
        delete this.layout.windows[key];
        placed = true;
      }
    }
    if (zChanged) this.restack();
    if (placed) this.save();
    this.recency(now);
    this.renderTray(live);
    this.renderShelf();
    this.renderZones();
    this.applySearch();
    if (this.mapOn) this.map.build();
    this.dirtyAll = true;
    this.request();
  }
  toggleDone(parentKey) {
    this.layout.showDone ??= {};
    if (this.layout.showDone[parentKey]) delete this.layout.showDone[parentKey];
    else this.layout.showDone[parentKey] = true;
    this.save();
    this.sync(this.snapshot, false);
  }
  addView(sess, animate) {
    const v = new WinView(this.api, sess, {
      onOpen: () => this.openSplit(sess.key),
      onClose: () => this.hide(sess.key),
      onToggleDone: () => this.toggleDone(sess.key)
    });
    v.z = ++this.zTop;
    this.views.set(sess.key, v);
    if (animate) {
      v.el.classList.add("is-new");
      v.el.addEventListener("animationend", () => v.el.classList.remove("is-new"), { once: true });
    }
    this.winsEl.append(v.el);
    this.applySize(v);
    return v;
  }
  dropView(v) {
    this.views.delete(v.key);
    this.leaving.delete(v.key);
    v.destroy();
  }
  /** Done: shrink and slide toward the shelf, then leave the world. */
  leave(v) {
    if (this.leaving.has(v.key)) return;
    this.leaving.add(v.key);
    const r = this.absRect(v.key);
    if (!this.motion || !r) {
      this.dropView(v);
      return;
    }
    const target = this.toWorld(this.size.w / 2, this.size.h - 12);
    v.el.classList.add("is-leaving");
    v.el.style.transform = `translate3d(${target.x - r.w / 2}px, ${target.y - r.h / 2}px, 0) scale(0.15)`;
    const done = () => this.dropView(v);
    v.el.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 500);
  }
  hide(key) {
    const pos = this.layout.windows[key];
    const v = this.views.get(key);
    if (!pos || !v) return;
    pos.hidden = v.session.state;
    if (pos.expanded) {
      pos.expanded = false;
    }
    this.dropView(v);
    this.save();
    this.sync(this.snapshot, false);
  }
  unhide(key) {
    const pos = this.layout.windows[key];
    if (pos) delete pos.hidden;
    this.save();
    this.sync(this.snapshot, false);
    const v = this.views.get(key);
    if (v) this.focusWin(key);
  }
  tick() {
    const now = Date.now();
    for (const v of this.views.values()) v.tick(now);
    this.recency(now);
  }
  /** The latest session gets its word; the others' borders and title fade by age bucket. */
  recency(now) {
    let latest;
    let latestAt = Number.NEGATIVE_INFINITY;
    for (const v of this.views.values()) {
      if (v.session.parentId || v.session.state === "done") continue;
      const at = Date.parse(v.session.lastAt);
      if (at > latestAt) {
        latestAt = at;
        latest = v;
      }
    }
    for (const v of this.views.values()) {
      const isLatest = v === latest;
      v.setLatest(isLatest);
      const age = now - Date.parse(v.session.lastAt);
      let bucket = 0;
      if (!isLatest && v.session.state !== "needs_you") {
        while (bucket < AGE_STEPS_MS.length && age >= AGE_STEPS_MS[bucket]) bucket++;
      }
      v.setAge(bucket);
    }
  }
  // ---------- colour and lines ----------
  get colourOn() {
    return this.api.local.get(COLOUR_LOCAL_KEY) ?? true;
  }
  toggleColour() {
    const on = !this.colourOn;
    this.api.local.set(COLOUR_LOCAL_KEY, on);
    this.applyColour();
    if (on && !this.api.local.get(LEGEND_SEEN_KEY)) {
      this.api.local.set(LEGEND_SEEN_KEY, true);
      this.showLegend(true);
    }
    if (!on) this.showLegend(false);
  }
  applyColour() {
    const on = this.colourOn;
    setClass(this.root, "has-colour", on);
    setClass(this.colourBtn, "is-on", on);
  }
  showLegend(on) {
    this.legend.hidden = !on;
    setClass(this.root, "has-legend", on);
  }
  get legendShown() {
    return !this.legend.hidden;
  }
  toggleLegend() {
    this.showLegend(!this.legendShown);
  }
  get linesMode() {
    const m = this.api.local.get(LINES_LOCAL_KEY);
    return m && LINES_MODES.includes(m) ? m : "hovered";
  }
  cycleLines() {
    const next = LINES_MODES[(LINES_MODES.indexOf(this.linesMode) + 1) % LINES_MODES.length];
    this.api.local.set(LINES_LOCAL_KEY, next);
    this.applyLines();
  }
  applyLines() {
    const mode = this.linesMode;
    for (const m of LINES_MODES) setClass(this.root, `lines-${m}`, m === mode);
    setText(this.linesBtn, `Lines \xB7 ${mode}`);
  }
  // ---------- geometry ----------
  pos(key) {
    const p = this.layout.windows[key];
    if (p) return p;
    const s = this.snapshot.sessions.get(key);
    const sub = !!s?.parentId;
    const np = { x: 0, y: 0, w: sub ? SUB_W : WIN_W, h: sub ? SUB_H : WIN_H, rel: sub };
    this.layout.windows[key] = np;
    return np;
  }
  parentKey(key) {
    const s = this.snapshot.sessions.get(key);
    if (!s?.parentId) return void 0;
    const pk = `${s.harness}:${s.parentId}`;
    return this.layout.windows[pk] ? pk : void 0;
  }
  shown(key) {
    const p = this.pos(key);
    if (p.expanded) {
      const maxW = this.narrow ? Math.max(p.w, (this.size.w - 24) / this.view.k) : Number.POSITIVE_INFINITY;
      return { w: Math.min(maxW, Math.max(p.ew ?? 0, p.w, EXP_W)), h: Math.max(p.eh ?? 0, p.h, EXP_H) };
    }
    return { w: p.w, h: p.h };
  }
  /** Absolute world rect, resolving a subagent's offset from its parent. */
  absRect(key) {
    const p = this.layout.windows[key];
    if (!p) return null;
    const { w, h } = this.shown(key);
    const pk = p.rel ? this.parentKey(key) : void 0;
    if (pk) {
      const pr = this.absRect(pk);
      if (pr) return { x: pr.x + p.x, y: pr.y + p.y, w, h };
    }
    return { x: p.x, y: p.y, w, h };
  }
  toWorld(sx, sy) {
    return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  }
  toScreen(wx, wy) {
    return { x: wx * this.view.k + this.view.x, y: wy * this.view.k + this.view.y };
  }
  visibleRects() {
    const out = [];
    for (const key of this.views.keys()) {
      const r = this.absRect(key);
      if (r) out.push(r);
    }
    return out;
  }
  /** A new window goes to the nearest free spot around the viewport centre; a subagent
   *  hangs under its parent, to the right of its siblings. */
  place(sess) {
    const sub = !!sess.parentId;
    const w = sub ? SUB_W : WIN_W;
    const h = sub ? SUB_H : WIN_H;
    if (sub) {
      const pk = `${sess.harness}:${sess.parentId}`;
      const parent = this.layout.windows[pk];
      if (parent) {
        const siblings = [...this.snapshot.sessions.values()].filter(
          (s) => s.parentId === sess.parentId && s.key !== sess.key && this.layout.windows[s.key]?.rel && this.views.has(s.key)
        );
        const taken2 = siblings.map((s) => this.layout.windows[s.key]);
        const x = parent.w + TREE_GAP;
        for (let y = 0; y < 4e3; y += h + TREE_ROW) {
          const r2 = { x, y, w, h };
          if (!taken2.some((t) => overlaps(r2, t, 2))) return { ...r2, rel: true };
        }
        return { x, y: 0, w, h, rel: true };
      }
    }
    let centre = this.toWorld(this.size.w / 2, this.size.h / 2);
    const taken = this.visibleRects();
    const nodeId = this.pendingStart.get(sess.key);
    if (nodeId) {
      this.pendingStart.delete(sess.key);
      const nr = this.map.nodeRect(nodeId);
      if (nr) {
        centre = { x: nr.x + nr.w / 2, y: nr.y - 40 - h / 2 };
        taken.push(...[...this.map.nodes.values()].map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })));
      }
    }
    const r = findFree(centre, w, h, taken);
    return { x: r.x, y: r.y, w, h };
  }
  // ---------- rendering ----------
  request() {
    if (this.frame) return;
    this.frame = requestAnimationFrame((t) => {
      this.frame = 0;
      this.render(t);
    });
  }
  render(t) {
    if (this.tween) {
      const p = clamp((t - this.tween.t0) / this.tween.ms, 0, 1);
      const e = 1 - (1 - p) ** 3;
      const { from, to } = this.tween;
      this.view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      this.dirtyVp = true;
      if (p >= 1) this.tween = void 0;
      else this.request();
    }
    if (this.dirtyVp) {
      const { x, y, k } = this.view;
      this.world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
      let s = 32 * k;
      while (s < 18) s *= 2;
      while (s > 72) s /= 2;
      this.root.style.setProperty("--cv-grid", `${s}px`);
      this.root.style.setProperty("--cv-grid-x", `${x}px`);
      this.root.style.setProperty("--cv-grid-y", `${y}px`);
      setText(this.zoomLabel, `${Math.round(k * 100)}%`);
      this.dirtyVp = false;
      this.saveVp();
    }
    const keys = this.dirtyAll ? this.views.keys() : this.dirtyWins;
    for (const key of keys) {
      const v = this.views.get(key);
      if (v && !this.leaving.has(key)) this.applyWin(v);
    }
    this.dirtyWins.clear();
    this.dirtyAll = false;
    this.drawTethers();
    this.drawZones();
    if (this.mapOn) {
      this.map.layoutNodes();
      this.map.draw();
    }
    this.drawMinimap();
  }
  applyWin(v) {
    const r = this.absRect(v.key);
    if (!r) return;
    v.el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
    this.applySize(v);
    const z = v.session.state === "needs_you" ? Z_NEEDS + v.z : v.z;
    const zs = String(z);
    if (v.el.style.zIndex !== zs) v.el.style.zIndex = zs;
  }
  applySize(v) {
    const { w, h } = this.shown(v.key);
    const ws = `${w}px`;
    const hs = `${h}px`;
    if (v.el.style.width !== ws) v.el.style.width = ws;
    if (v.el.style.height !== hs) v.el.style.height = hs;
  }
  restack() {
    for (const v of this.views.values()) this.dirtyWins.add(v.key);
  }
  /** Parent → child as an orthogonal hairline: out of the parent's right edge, down a
   *  trunk, into the child's left edge. */
  drawTethers() {
    const paths = [];
    for (const v of this.views.values()) {
      const p = this.layout.windows[v.key];
      if (!p?.rel) continue;
      const pk = this.parentKey(v.key);
      if (!pk || !this.views.has(pk)) continue;
      const a = this.absRect(v.key);
      const b = this.absRect(pk);
      if (!a || !b) continue;
      const x1 = b.x + b.w;
      const y1 = b.y + 14;
      const x2 = a.x;
      const y2 = a.y + 12;
      const right = x2 >= x1;
      const trunk = right ? x1 + Math.min(TREE_GAP / 2, (x2 - x1) / 2) : x1 + 8;
      paths.push(right ? `M${x1},${y1} H${trunk} V${y2} H${x2}` : `M${x1},${y1} H${trunk} V${y2} H${x2}`);
    }
    const sig = paths.join(";");
    if (this.treeG.dataset.sig === sig) return;
    this.treeG.dataset.sig = sig;
    this.treeG.replaceChildren(...paths.map((d) => svg("path", { d, class: "cv-tether" })));
  }
  // ---------- zones ----------
  renderZones() {
    const on = this.layout.zonesOn;
    setClass(this.root, "has-zones", on);
    if (!on) {
      this.zonesEl.replaceChildren();
      this.zoneEls.clear();
      return;
    }
    const names = /* @__PURE__ */ new Set();
    for (const m of this.snapshot.machines.keys()) names.add(m);
    for (const s of this.snapshot.sessions.values()) if (s.machine) names.add(s.machine);
    for (const name of names) {
      if (!this.layout.zones[name]) this.layout.zones[name] = this.defaultZone(name);
      if (!this.zoneEls.has(name)) {
        const z = el("div", "cv-zone");
        z.dataset.zone = name;
        const label = el("div", "cv-zone-label");
        label.append(el("span", "cv-zone-name", name), el("span", "cv-zone-n"));
        const handle = el("div", "cv-zone-resize");
        z.append(label, handle);
        this.zonesEl.append(z);
        this.zoneEls.set(name, z);
      }
    }
    for (const [name, z] of this.zoneEls) {
      if (!names.has(name)) {
        z.remove();
        this.zoneEls.delete(name);
      }
    }
  }
  defaultZone(name) {
    const rects = [];
    for (const [key, v] of this.views) {
      if (v.session.machine !== name) continue;
      const r2 = this.absRect(key);
      if (r2) rects.push(r2);
    }
    const b = bounds(rects);
    const PAD = 40;
    if (b) return { x: b.x - PAD, y: b.y - PAD - 8, w: b.w + PAD * 2, h: b.h + PAD * 2 + 8 };
    const taken = [...this.visibleRects(), ...Object.values(this.layout.zones)];
    const r = findFree(this.toWorld(this.size.w / 2, this.size.h / 2), 640, 420, taken, 80);
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }
  drawZones() {
    if (!this.layout.zonesOn) return;
    for (const [name, z] of this.zoneEls) {
      const r = this.layout.zones[name];
      if (!r) continue;
      z.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
      z.style.width = `${r.w}px`;
      z.style.height = `${r.h}px`;
      let n = 0;
      for (const key of this.views.keys()) {
        const wr = this.absRect(key);
        if (wr && wr.x + wr.w / 2 >= r.x && wr.x + wr.w / 2 <= r.x + r.w && wr.y + wr.h / 2 >= r.y && wr.y + wr.h / 2 <= r.y + r.h)
          n++;
      }
      const nEl = z.querySelector(".cv-zone-n");
      setText(nEl, n ? String(n) : "");
    }
  }
  toggleZones() {
    this.layout.zonesOn = !this.layout.zonesOn;
    setClass(this.zonesBtn, "is-on", this.layout.zonesOn);
    if (this.layout.zonesOn && Object.keys(this.layout.zones).length === 0) {
      this.tidy();
    } else {
      this.renderZones();
      this.dirtyAll = true;
      this.request();
      this.save();
    }
  }
  // ---------- tray and shelf ----------
  renderTray(live) {
    const hidden = live.filter((s) => this.layout.windows[s.key]?.hidden);
    this.tray.hidden = hidden.length === 0;
    const sig = hidden.map((s) => `${s.key}:${s.state}`).join(",");
    if (this.tray.dataset.sig === sig) return;
    this.tray.dataset.sig = sig;
    this.tray.replaceChildren(
      el("span", "cv-tray-label", "hidden"),
      ...hidden.map((s) => {
        const b = el("button", "cv-chip", this.api.format.title(s));
        b.type = "button";
        b.dataset.state = s.state;
        b.title = "Show again";
        b.addEventListener("click", () => this.unhide(s.key));
        return b;
      })
    );
  }
  renderShelf() {
    const done = [...this.snapshot.sessions.values()].filter((s) => s.state === "done" && !s.parentId).sort((a, b) => (b.endedAt ?? b.lastAt).localeCompare(a.endedAt ?? a.lastAt)).slice(0, SHELF_MAX);
    this.shelf.hidden = done.length === 0;
    const open = this.layout.shelfOpen;
    setClass(this.root, "has-shelf", done.length > 0);
    setClass(this.root, "shelf-open", done.length > 0 && open);
    setClass(this.shelf, "is-open", open);
    setText(this.shelfBtn, `Done \xB7 ${done.length}`);
    this.shelfBtn.setAttribute("aria-expanded", String(open));
    const now = Date.now();
    const sig = `${open}|${done.map((s) => s.key).join(",")}`;
    if (!open) {
      this.shelfTiles.replaceChildren();
      this.shelfTiles.dataset.sig = "";
      return;
    }
    if (this.shelfTiles.dataset.sig === sig) return;
    this.shelfTiles.dataset.sig = sig;
    this.shelfTiles.replaceChildren(
      ...done.map((s) => {
        const t = el("button", "cv-tile");
        t.type = "button";
        t.title = "Open the session";
        t.addEventListener("click", () => this.api.openSession(s.key));
        const meta = [this.api.format.ago(s.endedAt ?? s.lastAt, now), this.api.format.repoBranch(s)].filter(Boolean);
        t.append(el("span", "cv-tile-title", this.api.format.title(s)), el("span", "cv-tile-meta", meta.join(" \xB7 ")));
        return t;
      })
    );
  }
  // ---------- minimap ----------
  drawMinimap() {
    const c = this.minimap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== W * dpr || c.height !== H * dpr) {
      c.width = W * dpr;
      c.height = H * dpr;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const rects = this.visibleRects();
    const vpw = {
      x: -this.view.x / this.view.k,
      y: -this.view.y / this.view.k,
      w: this.size.w / this.view.k,
      h: this.size.h / this.view.k
    };
    const b = bounds([...rects, vpw]);
    if (!b) return;
    const pad = 20;
    const s = Math.min((W - pad * 2) / Math.max(1, b.w), (H - pad * 2) / Math.max(1, b.h));
    const ox = (W - b.w * s) / 2 - b.x * s;
    const oy = (H - b.h * s) / 2 - b.y * s;
    const css = getComputedStyle(this.root);
    const fg4 = css.getPropertyValue("--fg-4").trim() || "#888";
    const needs = css.getPropertyValue("--needs").trim() || "#d9a441";
    const line = css.getPropertyValue("--fg-3").trim() || "#666";
    ctx.lineWidth = 1;
    const px = (v) => Math.round(v) + 0.5;
    for (const [key, v] of this.views) {
      const r = this.absRect(key);
      if (!r) continue;
      const needsYou = v.session.state === "needs_you";
      ctx.strokeStyle = needsYou ? needs : fg4;
      ctx.globalAlpha = needsYou || v.session.state === "working" ? 1 : 0.6;
      ctx.strokeRect(
        px(ox + r.x * s),
        px(oy + r.y * s),
        Math.max(2, Math.round(r.w * s)),
        Math.max(2, Math.round(r.h * s))
      );
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = line;
    ctx.strokeRect(
      Math.round(ox + vpw.x * s) + 0.5,
      Math.round(oy + vpw.y * s) + 0.5,
      Math.round(vpw.w * s),
      Math.round(vpw.h * s)
    );
    this.minimapMap = { s, ox, oy };
  }
  minimapMap;
  jumpFromMinimap(e) {
    const m = this.minimapMap;
    if (!m) return;
    const r = this.minimap.getBoundingClientRect();
    const wx = (e.clientX - r.left - m.ox) / m.s;
    const wy = (e.clientY - r.top - m.oy) / m.s;
    this.animateTo({ x: this.size.w / 2 - wx * this.view.k, y: this.size.h / 2 - wy * this.view.k, k: this.view.k });
  }
  // ---------- viewport ----------
  animateTo(to) {
    to.k = clamp(to.k, ZOOM_MIN, ZOOM_MAX);
    if (!this.motion) {
      this.view = to;
      this.dirtyVp = true;
      this.request();
      this.commit();
      return;
    }
    this.tween = { from: { ...this.view }, to, t0: performance.now(), ms: 220 };
    this.request();
  }
  fit(animate = true) {
    const rects = this.visibleRects();
    if (this.layout.zonesOn) rects.push(...Object.values(this.layout.zones));
    if (this.mapOn) {
      const lanes = this.map.laneBounds();
      if (lanes) rects.push(lanes);
      for (const n of this.map.nodes.values()) rects.push({ x: n.x, y: n.y, w: n.w, h: n.h });
    }
    const b = bounds(rects);
    if (!b) {
      this.animateTo({ x: this.size.w / 2, y: this.size.h / 2, k: 1 });
      return;
    }
    const pad = this.narrow ? 12 : 48;
    const topPad = this.narrow ? 52 : 56;
    const shelfH = this.shelf.hidden ? 0 : this.layout.shelfOpen ? 98 : 28;
    const kw = (this.size.w - pad * 2) / b.w;
    const kh = (this.size.h - topPad - pad - shelfH) / b.h;
    const k = clamp(Math.min(kw, this.narrow ? 1 : kh, 1), ZOOM_MIN, ZOOM_MAX);
    const to = {
      x: (this.size.w - b.w * k) / 2 - b.x * k,
      y: this.narrow && kh < kw ? topPad - b.y * k : topPad + (this.size.h - topPad - shelfH - b.h * k) / 2 - b.y * k,
      k
    };
    if (animate) this.animateTo(to);
    else {
      this.view = to;
      this.dirtyVp = true;
      this.request();
    }
  }
  zoomTo(k) {
    const cx = this.size.w / 2;
    const cy = this.size.h / 2;
    this.zoomAt(cx, cy, k / this.view.k);
    this.commit();
  }
  // ---------- actions ----------
  tidy(animate = true) {
    const sessions = [...this.snapshot.sessions.values()].filter((s) => this.views.has(s.key));
    const r = tidy(sessions, (k) => this.pos(k), (this.layout.zonesOn || this.mapOn) && !this.narrow, this.narrow);
    if (this.motion && animate) {
      this.winsEl.classList.add("is-tidying");
      setTimeout(() => this.winsEl.classList.remove("is-tidying"), 400);
    }
    for (const [key, p] of r.windows) {
      const pos = this.pos(key);
      pos.x = p.x;
      pos.y = p.y;
    }
    if (this.layout.zonesOn) {
      this.layout.zones = {};
      for (const [name, z] of r.zones) this.layout.zones[name] = z;
      this.renderZones();
    }
    if (this.mapOn) this.map.relayout();
    this.dirtyAll = true;
    this.request();
    this.fit(animate);
    this.save();
    if (animate) this.say("tidied");
  }
  reset() {
    this.layout = emptyLayout();
    for (const v of [...this.views.values()]) this.dropView(v);
    setClass(this.zonesBtn, "is-on", false);
    this.api.local.set(MAP_LOCAL_KEY, null);
    this.applyMapOn();
    this.view = { x: this.size.w / 2, y: this.size.h / 2, k: 1 };
    this.sync(this.snapshot, true);
    this.fit();
    this.save();
    this.say("layout reset");
  }
  toggleExpandKey(key) {
    const v = this.views.get(key);
    const p = this.layout.windows[key];
    if (!v || !p) return;
    p.expanded = !p.expanded;
    v.setExpanded(!!p.expanded);
    this.focusWin(key);
    this.dirtyWins.add(key);
    this.request();
    this.save();
  }
  setQuery(q) {
    this.query = q.trim().toLowerCase();
    this.applySearch();
    if (this.query) this.revealHit();
  }
  /** If no match is on screen, bring the first one into view. */
  revealHit() {
    const vw = {
      x: -this.view.x / this.view.k,
      y: -this.view.y / this.view.k,
      w: this.size.w / this.view.k,
      h: this.size.h / this.view.k
    };
    let first = null;
    for (const v of this.views.values()) {
      if (!v.el.classList.contains("is-hit")) continue;
      const r = this.absRect(v.key);
      if (!r) continue;
      if (overlaps(r, vw, 0)) return;
      first ??= r;
    }
    if (!first) return;
    const k = this.view.k;
    this.animateTo({
      x: this.size.w / 2 - (first.x + first.w / 2) * k,
      y: this.size.h / 2 - (first.y + first.h / 2) * k,
      k
    });
  }
  applySearch() {
    const q = this.query;
    setClass(this.root, "is-searching", !!q);
    let hits = 0;
    for (const v of this.views.values()) {
      const s = v.session;
      const hay = [
        this.api.format.title(s),
        s.repo,
        s.branch,
        s.machine,
        s.harness,
        s.model,
        s.currentTool?.tool,
        s.progress?.assistant,
        s.lastAssistant,
        s.lastUser,
        s.openAttentions[0]?.message
      ].filter(Boolean).join(" ").toLowerCase();
      const hit = !!q && hay.includes(q);
      if (hit) hits++;
      setClass(v.el, "is-hit", hit);
      setClass(v.el, "is-dim", !!q && !hit);
    }
    if (q) this.say(hits === 1 ? "1 match" : `${hits} matches`);
    else this.say("");
  }
  say(text) {
    setText(this.status, text);
    this.status.hidden = !text;
    if (text) {
      clearTimeout(this.sayTimer);
      this.sayTimer = setTimeout(() => {
        if (!this.query) this.status.hidden = true;
      }, 1800);
    }
  }
  sayTimer;
  // ---------- InputHost ----------
  get shortcuts() {
    return this.api.shortcuts;
  }
  vp() {
    return this.view;
  }
  panBy(dx, dy) {
    this.tween = void 0;
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
    this.dirtyVp = true;
    this.request();
  }
  zoomAt(sx, sy, factor) {
    this.tween = void 0;
    const k = clamp(this.view.k * factor, ZOOM_MIN, ZOOM_MAX);
    const f = k / this.view.k;
    this.view = { x: sx - (sx - this.view.x) * f, y: sy - (sy - this.view.y) * f, k };
    this.dirtyVp = true;
    this.request();
  }
  zoomStep(dir) {
    this.animateTo(this.zoomedAround(this.size.w / 2, this.size.h / 2, dir > 0 ? 1.25 : 0.8));
  }
  /** Where the view is heading: the tween's end while one runs, so repeated steps add up. */
  zoomedAround(sx, sy, factor) {
    const v = this.tween?.to ?? this.view;
    const k = clamp(v.k * factor, ZOOM_MIN, ZOOM_MAX);
    const f = k / v.k;
    return { x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f, k };
  }
  hit(target) {
    const t = target;
    if (!t || !(t instanceof Element)) return { kind: "canvas" };
    if (t.closest(".cv-hud, .cv-tray, .cv-shelf, .cv-minimap, .cv-status, .cv-legend")) return { kind: "ui" };
    const win = t.closest(".cv-win");
    if (win) {
      const key = win.dataset.key;
      if (t.closest("button, a, input")) return { kind: "win", key, part: "control" };
      if (t.closest(".cv-win-resize")) return { kind: "win", key, part: "resize" };
      if (t.closest(".cv-detail-list")) return { kind: "win", key, part: "scroll" };
      if (t.closest(".cv-win-bar")) return { kind: "win", key, part: "bar" };
      return { kind: "win", key, part: "body" };
    }
    const node = t.closest(".cv-node");
    if (node) {
      const id = node.dataset.id;
      const custom = node.dataset.kind === "custom";
      if (t.closest(".cv-node-h")) return { kind: "node", id, part: "handle", custom };
      const chip = t.closest(".cv-chip-a");
      if (chip) return { kind: "node", id, part: "chip", chip: chip.dataset.chip, custom };
      if (t.closest(".cv-node-edit[contenteditable='true']")) return { kind: "node", id, part: "edit", custom };
      return { kind: "node", id, part: "body", custom };
    }
    const link = t.closest("[data-link]");
    if (link?.dataset.link) return { kind: "link", id: link.dataset.link };
    if (t.closest(".cv-pop, .cv-ghost")) return { kind: "ui" };
    const zone = t.closest(".cv-zone");
    if (zone) {
      const name = zone.dataset.zone;
      if (t.closest(".cv-zone-resize")) return { kind: "zone", name, part: "resize" };
      if (t.closest(".cv-zone-label")) return { kind: "zone", name, part: "label" };
    }
    return { kind: "canvas" };
  }
  winRect(key) {
    return this.absRect(key);
  }
  moveWin(key, x, y) {
    const p = this.layout.windows[key];
    if (!p) return;
    if (p.rel) {
      const pk = this.parentKey(key);
      const pr = pk ? this.absRect(pk) : null;
      if (pr) {
        p.x = x - pr.x;
        p.y = y - pr.y;
      } else {
        p.x = x;
        p.y = y;
      }
    } else {
      p.x = x;
      p.y = y;
    }
    this.dirtyAll = true;
    this.request();
  }
  resizeWin(key, w, h) {
    const p = this.layout.windows[key];
    if (!p) return;
    const cw = clamp(w, MIN_W, MAX_W);
    const ch = clamp(h, MIN_H, MAX_H);
    if (p.expanded) {
      p.ew = cw;
      p.eh = ch;
    } else {
      p.w = cw;
      p.h = ch;
    }
    this.dirtyWins.add(key);
    this.dirtyAll = true;
    this.request();
  }
  zoneRect(name) {
    return this.layout.zones[name] ?? null;
  }
  moveZone(name, x, y) {
    const z = this.layout.zones[name];
    if (!z) return;
    z.x = x;
    z.y = y;
    this.request();
  }
  resizeZone(name, w, h) {
    const z = this.layout.zones[name];
    if (!z) return;
    z.w = Math.max(160, w);
    z.h = Math.max(120, h);
    this.request();
  }
  focusWin(key) {
    const v = this.views.get(key);
    if (!v) return;
    if (v.z !== this.zTop) v.z = ++this.zTop;
    if (document.activeElement !== v.el && !v.el.contains(document.activeElement)) v.el.focus({ preventScroll: true });
    this.dirtyWins.add(key);
    this.request();
  }
  toggleExpand(key) {
    this.toggleExpandKey(key);
  }
  focusedKey() {
    const a = document.activeElement;
    const w = a?.closest(".cv-win");
    return w?.dataset.key;
  }
  nudgeFocused(dx, dy) {
    const key = this.focusedKey();
    if (!key) return;
    const r = this.absRect(key);
    if (!r) return;
    this.moveWin(key, r.x + dx, r.y + dy);
  }
  expandFocused() {
    const key = this.focusedKey();
    if (key) this.toggleExpandKey(key);
  }
  focusSearch() {
    this.search.focus();
    this.search.select();
  }
  clearSearch() {
    if (this.search.value) this.search.value = "";
    this.setQuery("");
  }
  commit() {
    this.save();
    this.saveVp();
    this.save.flush();
  }
  // ---------- the map ----------
  /** On phones the map is a per-device choice (off by default); elsewhere it is shared. */
  get mapOn() {
    if (this.narrow) return this.api.local.get(MAP_LOCAL_KEY) ?? false;
    return !!this.layout.mapOn;
  }
  toggleMap() {
    if (this.narrow) this.api.local.set(MAP_LOCAL_KEY, !this.mapOn);
    else {
      this.layout.mapOn = !this.layout.mapOn;
      this.save();
    }
    this.applyMapOn();
    if (this.mapOn) this.fit();
  }
  applyMapOn() {
    const on = this.mapOn;
    setClass(this.root, "has-map", on);
    setClass(this.mapBtn, "is-on", on);
    this.map.setOn(on);
    if (on) {
      this.map.build();
      this.map.layoutNodes();
    }
    this.dirtyAll = true;
    this.request();
  }
  addCustomNode() {
    if (!this.mapOn) this.toggleMap();
    const c = this.toWorld(this.size.w / 2, this.size.h / 2 - 40);
    this.map.addCustom(Math.round(c.x / GRID) * GRID, Math.round(c.y / GRID) * GRID);
    this.save();
    this.request();
  }
  mapHost() {
    return {
      api: this.api,
      root: this.root,
      world: this.world,
      tethers: this.tethers,
      layout: () => this.layout,
      snapshot: () => this.snapshot,
      liveWindows: () => {
        const out = [];
        for (const v of this.views.values()) {
          if (v.session.parentId || v.session.state === "done" || this.leaving.has(v.key)) continue;
          const rect = this.absRect(v.key);
          if (rect) out.push({ session: v.session, rect });
        }
        return out;
      },
      toScreen: (wx, wy) => this.toScreen(wx, wy),
      request: () => this.request(),
      save: () => this.save(),
      narrow: () => this.narrow,
      taken: () => [
        ...this.visibleRects(),
        ...[...this.map.nodes.values()].map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
      ],
      onStarted: (session, nodeId) => {
        this.pendingStart.set(session, nodeId);
        const machine = this.map.nodes.get(nodeId)?.label ?? "the machine";
        this.say(`starting on ${machine}`);
      }
    };
  }
  hitAt(sx, sy) {
    const r = this.root.getBoundingClientRect();
    const el2 = document.elementFromPoint(sx + r.left, sy + r.top);
    return this.hit(el2);
  }
  nodeRect(id) {
    return this.map.nodeRect(id);
  }
  moveNode(id, x, y) {
    this.map.moveNode(id, x, y);
    this.request();
  }
  beginLink(id) {
    this.map.beginLink(id);
  }
  moveLink(wx, wy) {
    this.map.moveLink(wx, wy);
  }
  endLink(target) {
    this.map.endLink(target);
  }
  beginGhost(chip, sx, sy) {
    this.map.beginGhost(chip, sx, sy);
  }
  moveGhost(sx, sy) {
    this.map.moveGhost(sx, sy);
  }
  endGhost(target) {
    this.map.endGhost(target);
  }
  select(id) {
    this.map.select(id);
  }
  deleteSelected() {
    return this.map.deleteSelected();
  }
  busyTyping() {
    return this.map.isEditing || this.map.hasPopover;
  }
  hover(id) {
    if (!this.mapOn) return;
    this.map.setFocus(id);
  }
  answerFocused(decision) {
    const key = this.focusedKey();
    const v = key ? this.views.get(key) : void 0;
    void v?.answer(decision);
  }
  /** Enter: the prompt line when the host can carry one, else the session beside the canvas. */
  enterFocused() {
    const key = this.focusedKey();
    const v = key ? this.views.get(key) : void 0;
    if (!v) return;
    if (!v.focusPrompt()) this.openSplit(key);
  }
  /** The session page in the host's split panel, morphing out of the window's rect. */
  openSplit(key) {
    const v = this.views.get(key);
    const r = v?.el.getBoundingClientRect();
    this.api.openSession(
      key,
      r ? { split: true, from: { x: r.x, y: r.y, width: r.width, height: r.height } } : { split: true }
    );
  }
};
var theme = {
  mount(container, api) {
    const c = new Canvas(container, api);
    return () => c.destroy();
  }
};
var index_default = theme;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
