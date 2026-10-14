// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type FeedPage,
  type Info,
  ROUTES,
  type SessionDetail,
  type Snapshot,
  UI_KEY_COOKIE,
} from "../../shared/api.js";
import { Session, tempDir } from "../../test/events.js";
import { type App, createApp } from "../app.js";
import { lanAddresses } from "../http/net.js";
import type { Ctx } from "../http/router.js";
import { uiAuth } from "./auth.js";

let app: App;
let tmp: { dir: string; cleanup: () => void };
let web: string;

beforeAll(async () => {
  tmp = tempDir();
  web = path.join(tmp.dir, "web");
  mkdirSync(path.join(web, "assets"), { recursive: true });
  writeFileSync(path.join(web, "index.html"), "<!doctype html><title>board</title>");
  writeFileSync(path.join(web, "assets", "app.js"), "console.log(1)");
  app = await createApp({ port: 0, stateDir: tmp.dir, outbox: false, quiet: true, webDir: web });
  const s = new Session();
  app.store.ingest([s.ev("session.started", { source: "startup" }), s.ev("turn.started", { turn_id: "t" })], "http");
});
afterAll(async () => {
  await app.close();
  tmp.cleanup();
});

const fakeCtx = (o: { loopback?: boolean; cookie?: string; query?: string }): Ctx =>
  ({
    remote: { ip: o.loopback ? "127.0.0.1" : "192.168.1.9", loopback: o.loopback ?? false },
    url: new URL(`http://x/${o.query ?? ""}`),
    cookies: () => (o.cookie ? { [UI_KEY_COOKIE]: o.cookie } : {}),
  }) as unknown as Ctx;

describe("uiAuth", () => {
  it("admits loopback, the cookie, or ?k=, and nothing else", () => {
    expect(uiAuth(fakeCtx({ loopback: true }), "key")).toBe(true);
    expect(uiAuth(fakeCtx({ cookie: "key" }), "key")).toBe(true);
    expect(uiAuth(fakeCtx({ query: "?k=key" }), "key")).toBe(true);
    expect(uiAuth(fakeCtx({ cookie: "nope" }), "key")).toBe(false);
    expect(uiAuth(fakeCtx({ query: "?k=nope" }), "key")).toBe(false);
    expect(uiAuth(fakeCtx({}), "key")).toBe(false);
    expect(uiAuth(fakeCtx({ cookie: "" }), "")).toBe(false);
  });
});

describe("UI API", () => {
  it("info carries the urls, the sink command and the sources", async () => {
    const info = (await (await fetch(`${app.url}${ROUTES.ui.info}`)).json()) as Info;
    expect(info).toMatchObject({
      name: "sessionpipe-gui",
      port: app.port,
      sinkToken: app.config().sinkToken,
      uiKey: app.config().uiKey,
      sources: { http: true, outbox: null, demo: false },
      control: { enabled: true, rpId: "localhost" },
    });
    expect(info.urls.local).toBe(`http://localhost:${app.port}`);
    expect(info.sinkCommand).toMatch(/^sessionpipe sink add http:\/\/[\d.]+:\d+ --tier 3 --token spg_/);
    expect(info.wellKnown).toMatchObject({ protocol: [1] });
  });

  it("snapshot lists sessions, machines and stats", async () => {
    const snap = (await (await fetch(`${app.url}${ROUTES.ui.snapshot}`)).json()) as Snapshot;
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]).toMatchObject({ harness: "claude-code", state: "working" });
    expect(snap.machines[0]).toMatchObject({ name: "misha-air", sessions: 1, working: 1 });
    expect(snap.stats).toMatchObject({ events: 2, sessions: 1 });
  });

  it("streams a snapshot first, then events", async () => {
    const res = await fetch(`${app.url}${ROUTES.ui.stream}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const until = async (pred: () => boolean) => {
      while (!pred()) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
      }
    };
    await until(() => text.includes("\n\n"));
    const first = text.split("\n\n")[0]!;
    expect(first.startsWith("event: snapshot\ndata: ")).toBe(true);
    const msg = JSON.parse(first.slice("event: snapshot\ndata: ".length));
    expect(msg.kind).toBe("snapshot");
    expect(msg.snapshot.sessions).toHaveLength(1);
    app.store.ingest([new Session("live").ev("session.started")], "http");
    await until(() => text.includes("event: event\n"));
    expect(text).toContain('"kind":"event"');
    await reader.cancel();
  });

  it("serves the session detail, the feed and forget", async () => {
    const key = "claude-code/8c132906-8c3f-4814-870a-afc3d05e1d2e";
    const d = (await (await fetch(`${app.url}${ROUTES.ui.session}/${key}?after=0&limit=5`)).json()) as SessionDetail;
    expect(d.events.map((e) => e.session.seq)).toEqual([1]);
    expect(d.total).toBe(2);
    expect((await fetch(`${app.url}${ROUTES.ui.session}/claude-code/none`)).status).toBe(404);
    const feed = (await (await fetch(`${app.url}${ROUTES.ui.feed}?limit=1&type=turn.started`)).json()) as FeedPage;
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]!.type).toBe("turn.started");
    const gone = new Session("gone");
    app.store.ingest([gone.ev("session.started")], "http");
    expect((await fetch(`${app.url}${ROUTES.ui.forget}/claude-code/gone/forget`, { method: "POST" })).status).toBe(204);
    expect((await fetch(`${app.url}${ROUTES.ui.session}/claude-code/gone`)).status).toBe(404);
    expect((await fetch(`${app.url}${ROUTES.ui.forget}/claude-code/gone/forget`, { method: "POST" })).status).toBe(404);
  });

  it("renders the QR code as SVG of the LAN URL with the key", async () => {
    const res = await fetch(`${app.url}${ROUTES.ui.qr}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/);
    const svg = await res.text();
    expect(svg).toContain("<svg");
  });

  it("rotates the sink token from loopback and the old one stops working", async () => {
    const old = app.config().sinkToken;
    const res = await fetch(`${app.url}${ROUTES.ui.rotateToken}`, { method: "POST" });
    const { sinkToken } = (await res.json()) as { sinkToken: string };
    expect(sinkToken).not.toBe(old);
    expect(app.config().sinkToken).toBe(sinkToken);
    const s = new Session("rot");
    const send = (t: string) =>
      fetch(`${app.url}${ROUTES.events}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
        body: JSON.stringify({ events: [s.ev("session.started")] }),
      });
    expect((await send(old)).status).toBe(401);
    expect((await send(sinkToken)).status).toBe(202);
  });

  it("toggles demo", async () => {
    const on = await (
      await fetch(`${app.url}${ROUTES.ui.demo}`, { method: "POST", body: JSON.stringify({ on: true }) })
    ).json();
    expect(on).toEqual({ on: true });
    expect(((await (await fetch(`${app.url}${ROUTES.ui.info}`)).json()) as Info).sources.demo).toBe(true);
    const off = await (
      await fetch(`${app.url}${ROUTES.ui.demo}`, { method: "POST", body: JSON.stringify({ on: false }) })
    ).json();
    expect(off).toEqual({ on: false });
    expect((await fetch(`${app.url}${ROUTES.ui.demo}`, { method: "POST", body: "{}" })).status).toBe(400);
  });
});

describe("static", () => {
  it("serves the app, assets immutable, the SPA fallback, and sets the cookie from ?k=", async () => {
    const home = await fetch(`${app.url}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("board");
    const asset = await fetch(`${app.url}/assets/app.js`);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("content-type")).toMatch(/javascript/);
    const spa = await fetch(`${app.url}/sessions/claude-code/x`);
    expect(spa.status).toBe(200);
    expect(spa.headers.get("content-type")).toMatch(/text\/html/);
    expect(await spa.text()).toContain("board");
    expect((await fetch(`${app.url}/../package.json`)).status).toBe(200);
    expect((await fetch(`${app.url}/api/nope`)).status).toBe(404);
    const key = app.config().uiKey;
    const withKey = await fetch(`${app.url}/sessions/x?k=${key}&tab=2`, { redirect: "manual" });
    expect(withKey.status).toBe(302);
    expect(withKey.headers.get("location")).toBe("/sessions/x?tab=2");
    expect(withKey.headers.get("set-cookie")).toBe(`${UI_KEY_COOKIE}=${key}; Path=/; Max-Age=31536000; SameSite=Lax`);
  });

  const lan = lanAddresses()[0];
  it.skipIf(!lan)("turns a LAN visitor away without the key, and in with it", async () => {
    const base = `http://${lan}:${app.port}`;
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(401);
    expect(await page.text()).toContain("needs its key");
    expect((await fetch(`${base}${ROUTES.ui.snapshot}`)).status).toBe(401);
    expect((await fetch(`${base}${ROUTES.ui.rotateToken}`, { method: "POST" })).status).toBe(401);
    const key = app.config().uiKey;
    expect((await fetch(`${base}${ROUTES.ui.snapshot}?k=${key}`)).status).toBe(200);
    expect(
      (await fetch(`${base}${ROUTES.ui.snapshot}`, { headers: { cookie: `${UI_KEY_COOKIE}=${key}` } })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}${ROUTES.ui.rotateToken}`, {
          method: "POST",
          headers: { cookie: `${UI_KEY_COOKIE}=${key}` },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${base}${ROUTES.wellKnown}`)).status).toBe(200);
  });
});
