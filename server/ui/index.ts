// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. The UI API under /api/ui (ARCHITECTURE.md "UI API"): what the
// web app reads and the few things it may do. Every route needs uiAuth; the token
// rotation only loopback.
import QRCode from "qrcode";
import {
  type FeedQuery,
  type Info,
  type MachineSummary,
  ROUTES,
  type Snapshot,
  sessionKey,
  UI_KEY_PARAM,
} from "../../shared/api.js";
import type { Control } from "../control/index.js";
import type { Ctx, Handler, Reply, Router } from "../http/router.js";
import type { Store } from "../store/store.js";
import { uiAuth } from "./auth.js";
import { serveStream } from "./stream.js";

export interface UiDeps {
  store: Store;
  control: Control;
  uiKey: () => string;
  /** Everything Info says; built by app.ts, which knows the port, the sources and the dir. */
  info: () => Info;
  /** Makes a new sink token, persists it and returns it. */
  rotateSinkToken: () => string;
  demo: { on: () => boolean; set: (on: boolean) => void };
  /** SSE ping interval (tests). */
  pingMs?: number;
}

/** The store's snapshot with what control knows about each machine merged in, plus
 *  machines control paired that sent no event yet. */
export function snapshotWithControl(store: Store, control: Control): Snapshot {
  const snap = store.snapshot();
  const paired = control.machines();
  const seen = new Set<string>();
  for (const m of snap.machines) {
    seen.add(m.name);
    const c = paired.get(m.name);
    if (c) m.control = c;
  }
  for (const [name, c] of paired) {
    if (seen.has(name)) continue;
    const m: MachineSummary = {
      name,
      lastAt: c.lastPollAt ?? c.lastHelloAt ?? snap.at,
      harnesses: Object.fromEntries((c.harnesses ?? []).map((h) => [h, undefined])),
      sessions: 0,
      working: 0,
      needsYou: 0,
      control: c,
    };
    snap.machines.push(m);
  }
  snap.stats.machines = snap.machines.length;
  return snap;
}

export function registerUi(router: Router, deps: UiDeps): void {
  const guard =
    (h: Handler): Handler =>
    (ctx) =>
      uiAuth(ctx, deps.uiKey()) ? h(ctx) : { status: 401, json: { reason: "unauthorized" } };
  const snapshot = (): Snapshot => snapshotWithControl(deps.store, deps.control);

  router.get(
    ROUTES.ui.info,
    guard(() => ({ status: 200, json: deps.info() })),
  );
  router.get(
    ROUTES.ui.snapshot,
    guard(() => ({ status: 200, json: snapshot() })),
  );
  router.get(
    ROUTES.ui.stream,
    guard((ctx) => {
      serveStream(ctx, { store: deps.store, control: deps.control, snapshot, pingMs: deps.pingMs });
    }),
  );

  router.get(
    `${ROUTES.ui.session}/:harness/:id`,
    guard((ctx): Reply => {
      const key = sessionKey(ctx.params.harness!, ctx.params.id!);
      const after = intParam(ctx, "after");
      const limit = intParam(ctx, "limit");
      const detail = deps.store.sessionDetail(key, after, limit);
      if (!detail) return { status: 404, json: { reason: "not_found" } };
      return { status: 200, json: detail };
    }),
  );

  router.post(
    `${ROUTES.ui.forget}/:harness/:id/forget`,
    guard((ctx): Reply => {
      const key = sessionKey(ctx.params.harness!, ctx.params.id!);
      if (!deps.store.forget(key)) return { status: 404, json: { reason: "not_found" } };
      return { status: 204, text: "" };
    }),
  );

  router.get(
    ROUTES.ui.feed,
    guard((ctx): Reply => {
      const p = ctx.url.searchParams;
      const q: FeedQuery = {};
      const limit = intParam(ctx, "limit");
      if (limit !== undefined) q.limit = limit;
      for (const k of ["before", "harness", "machine", "type", "session", "q"] as const) {
        const v = p.get(k);
        if (v) q[k] = v;
      }
      return { status: 200, json: deps.store.feed(q) };
    }),
  );

  router.post(
    ROUTES.ui.rotateToken,
    guard((ctx): Reply => {
      if (!ctx.remote.loopback) return { status: 403, json: { reason: "loopback_only" } };
      return { status: 200, json: { sinkToken: deps.rotateSinkToken() } };
    }),
  );

  router.post(
    ROUTES.ui.demo,
    guard(async (ctx): Promise<Reply> => {
      let body: { on?: unknown } = {};
      try {
        body = await ctx.json<{ on?: unknown }>(4096);
      } catch {
        return { status: 400, json: { reason: "malformed" } };
      }
      if (typeof body?.on !== "boolean") return { status: 400, json: { reason: "malformed" } };
      deps.demo.set(body.on);
      return { status: 200, json: { on: deps.demo.on() } };
    }),
  );

  router.get(
    ROUTES.ui.qr,
    guard(async (): Promise<Reply> => {
      const info = deps.info();
      const base = info.urls.lan[0] ?? info.urls.local;
      const url = `${base}/?${UI_KEY_PARAM}=${encodeURIComponent(info.uiKey)}`;
      const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return {
        status: 200,
        text: svg,
        headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store" },
      };
    }),
  );
}

function intParam(ctx: Ctx, name: string): number | undefined {
  const v = ctx.url.searchParams.get(name);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}
