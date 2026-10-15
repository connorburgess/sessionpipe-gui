// SPDX-License-Identifier: Apache-2.0
// The extras catalogue (shape: every official extension bundled), the install route
// (loopback only, streams the installer's lines; exercised with a test catalogue, since
// nothing in the real one is left to install) and the CLI-side helpers, with the
// installer faked: nothing here reaches npm.

import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type ExtraEntry, type ExtrasResponse, ROUTES } from "../../shared/api.js";
import { tempDir } from "../../test/events.js";
import { Router } from "../http/router.js";
import { EXTRAS, findExtra, formatCatalog, installableExtras } from "./catalog.js";
import { type ExtrasDirs, extraInstalled, installHandler, registerExtras } from "./extras.js";
import { InstallError } from "./install.js";
import { EXTENSION_ID_RE } from "./kind.js";

/** A catalogue with something left to install, for the install route. */
const TEST_CATALOG: ExtraEntry[] = [
  { ...findExtra("canvas")!, bundled: true },
  { ...findExtra("spacesheep-vivid")!, bundled: false },
  { ...findExtra("ping-a-human")!, bundled: false },
];

describe("extras catalogue", () => {
  it("has the five official extras, well-formed, every one bundled", () => {
    expect(EXTRAS.map((e) => e.id)).toEqual(["canvas", "office", "spacesheep-vivid", "paper-serif", "ping-a-human"]);
    for (const e of EXTRAS) {
      expect(e.id).toMatch(EXTENSION_ID_RE);
      expect(["view", "skin", "plugin"]).toContain(e.kind);
      // Either spelling: the scope, or the unscoped fallback scripts/rename-unscoped.mjs writes.
      expect(e.npm).toMatch(/^(@sessionpipe-gui\/|sessionpipe-gui-)(theme|skin|plugin)-[a-z0-9-]+$/);
      expect(e.npm.endsWith(`-${e.id}`)).toBe(true);
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.line.length).toBeGreaterThan(20);
      expect(e.size).toMatch(/^\d+ [kM]B$/);
    }
    expect(EXTRAS.every((e) => e.bundled)).toBe(true);
    expect(installableExtras()).toEqual([]);
    expect(findExtra("paper-serif")?.kind).toBe("skin");
    expect(findExtra("nope")).toBeUndefined();
  });

  it("formats one block per entry with the state in brackets, no npm name", () => {
    const text = formatCatalog(() => false);
    expect(text).toContain("canvas             view    Canvas  [bundled]");
    expect(text).toContain("paper-serif        skin    Paper Serif  [bundled]");
    expect(text).toContain("ping-a-human       plugin  ping-a-human  [bundled]\n");
    expect(text).toContain("Off until you enable it.\n    27 kB");
    expect(text).not.toContain("@sessionpipe-gui/");
  });

  it("extraInstalled counts a bundled skin or plugin beside the bundled views dir", () => {
    const tmp = tempDir();
    try {
      const dirs: ExtrasDirs = {
        themes: path.join(tmp.dir, "themes"),
        skins: path.join(tmp.dir, "skins"),
        plugins: path.join(tmp.dir, "plugins"),
        bundled: path.join(tmp.dir, "bundled", "views"),
      };
      for (const rel of [
        "views/office/theme.json",
        "skins/paper-serif/skin.json",
        "plugins/ping-a-human/plugin.json",
      ]) {
        mkdirSync(path.dirname(path.join(tmp.dir, "bundled", rel)), { recursive: true });
        writeFileSync(path.join(tmp.dir, "bundled", rel), "{}");
      }
      expect(EXTRAS.map((e) => [e.id, extraInstalled(dirs, e)])).toEqual([
        ["canvas", false],
        ["office", true],
        ["spacesheep-vivid", false],
        ["paper-serif", true],
        ["ping-a-human", true],
      ]);
    } finally {
      tmp.cleanup();
    }
  });
});

describe("extras routes", () => {
  let tmp: { dir: string; cleanup: () => void };
  let dirs: ExtrasDirs;
  let server: http.Server;
  let base: string;
  const install = vi.fn(async (_d: ExtrasDirs, e: ExtraEntry) => {
    if (e.id === "ping-a-human") throw new InstallError("npm install failed: offline");
    return {
      manifest: { id: e.id, name: e.name, version: "0.1.0" },
      dir: "/x",
      message: `installed ${e.id}`,
      replaced: false,
    };
  });
  const after = vi.fn();

  beforeAll(async () => {
    tmp = tempDir();
    dirs = {
      themes: path.join(tmp.dir, "themes"),
      skins: path.join(tmp.dir, "skins"),
      plugins: path.join(tmp.dir, "plugins"),
      bundled: path.join(tmp.dir, "bundled", "views"),
    };
    mkdirSync(path.join(dirs.bundled!, "canvas"), { recursive: true });
    writeFileSync(path.join(dirs.bundled!, "canvas", "theme.json"), "{}");
    mkdirSync(path.join(dirs.skins, "paper-serif"), { recursive: true });
    writeFileSync(path.join(dirs.skins, "paper-serif", "skin.json"), "{}");
    const router = new Router();
    registerExtras(router, { uiAuth: () => true, dirs, install, after, catalog: TEST_CATALOG });
    server = http.createServer((req, res) => void router.handle(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    tmp.cleanup();
  });

  it("lists the catalogue with what is installed (bundled views count)", async () => {
    const res = await fetch(`${base}${ROUTES.ui.extras}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as ExtrasResponse;
    expect(body.extras.map((e) => [e.id, e.installed])).toEqual([
      ["canvas", true],
      ["spacesheep-vivid", false],
      ["ping-a-human", false],
    ]);
    expect(extraInstalled(dirs, findExtra("office")!)).toBe(false);
    expect(extraInstalled(dirs, findExtra("paper-serif")!)).toBe(true);
  });

  it("installs on POST from loopback, streaming the lines and ending with ok", async () => {
    const res = await fetch(`${base}${ROUTES.ui.extras}/spacesheep-vivid/install`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    const text = await res.text();
    expect(text.split("\n")).toEqual([
      "installing Spacesheep Vivid from npm (@sessionpipe-gui/skin-spacesheep-vivid)…",
      "installed spacesheep-vivid",
      "ok",
      "",
    ]);
    expect(install).toHaveBeenCalledWith(dirs, expect.objectContaining({ id: "spacesheep-vivid" }));
    expect(after).toHaveBeenCalledWith("skin");
  });

  it("ends with failed when the installer throws, and after() is not called", async () => {
    after.mockClear();
    const text = await (await fetch(`${base}${ROUTES.ui.extras}/ping-a-human/install`, { method: "POST" })).text();
    expect(text).toBe(
      "installing ping-a-human from npm (@sessionpipe-gui/plugin-ping-a-human)…\nnpm install failed: offline\nfailed\n",
    );
    expect(after).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown id and 409 for a bundled one", async () => {
    expect((await fetch(`${base}${ROUTES.ui.extras}/nope/install`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}${ROUTES.ui.extras}/canvas/install`, { method: "POST" })).status).toBe(409);
    expect((await fetch(`${base}${ROUTES.ui.extras}/paper-serif/install`)).status).toBe(405);
  });

  it("refuses the install away from loopback with 403, before touching the installer", async () => {
    install.mockClear();
    const ctx = {
      remote: { ip: "10.0.0.2", loopback: false },
      params: { id: "spacesheep-vivid" },
      url: new URL("http://x/"),
      cookies: () => ({}),
    };
    const reply = await installHandler({ uiAuth: () => true, dirs, install, catalog: TEST_CATALOG })(ctx as never);
    expect(reply).toMatchObject({ status: 403, json: { reason: "loopback_only" } });
    expect(install).not.toHaveBeenCalled();
  });

  it("with the real catalogue, every install is a 409: everything is bundled", async () => {
    install.mockClear();
    const ctx = {
      remote: { ip: "127.0.0.1", loopback: true },
      url: new URL("http://x/"),
      cookies: () => ({}),
    };
    for (const e of EXTRAS) {
      const reply = await installHandler({ uiAuth: () => true, dirs, install })({
        ...ctx,
        params: { id: e.id },
      } as never);
      expect(reply).toMatchObject({ status: 409, json: { reason: "bundled" } });
    }
    expect(install).not.toHaveBeenCalled();
  });

  it("needs the UI key, like the rest of /api/ui", async () => {
    const router = new Router();
    registerExtras(router, { uiAuth: () => false, dirs, install });
    const ctx = { remote: { ip: "10.0.0.2", loopback: false }, url: new URL("http://x/"), cookies: () => ({}) };
    expect(await router.match("GET", ROUTES.ui.extras)!.handler(ctx as never)).toMatchObject({ status: 401 });
  });
});
