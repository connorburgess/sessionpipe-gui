// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core (composition root). Every module plugs in here and nowhere
// else. Module boundaries and who owns what: ARCHITECTURE.md.
import http from "node:http";
import https from "node:https";
import type net from "node:net";
import path from "node:path";
import { DEFAULT_PORT, type Info, ROUTES } from "../shared/api.js";
import { defaultStateDir, type GuiConfig, packageVersion, readGuiConfig, rotateSinkToken } from "./config.js";
import { type Control, createControl } from "./control/index.js";
import { type Runner, startDemo, startReplay } from "./demo/index.js";
import { lanAddresses } from "./http/net.js";
import { Router } from "./http/router.js";
import { registerReceiver, wellKnown } from "./receiver/index.js";
import { type OutboxSource, startOutboxSource } from "./sources/outbox.js";
import { staticFiles, webDir } from "./static.js";
import { Store } from "./store/store.js";
import { registerThemes, ThemeRegistry } from "./themes/index.js";
import { ensureCerts, type TlsMaterial } from "./tls/certs.js";
import { createDualListener, type DualListener, listen } from "./tls/listen.js";
import { registerTrust } from "./tls/trust.js";
import { uiAuthFor } from "./ui/auth.js";
import { registerUi } from "./ui/index.js";

export interface AppOptions {
  port?: number;
  host?: string;
  stateDir?: string;
  /** Tail the local sessionpipe outbox (zero-config on the machine that runs agents). Default true. */
  outbox?: boolean;
  /** The sessionpipe state dir (or its outbox folder) to tail; default: sessionpipe's own. */
  outboxPath?: string;
  /** Generate synthetic sessions so the board is never empty. */
  demo?: boolean;
  /** Replay a sessionpipe JSONL file through the store. */
  replay?: string;
  /** Replay / demo speed. */
  speed?: number;
  /** The rp id control passkeys are made for (CONTROL.md §2); "localhost" by default,
   *  the `.local` hostname when `tls` is on. */
  rpId?: string;
  /** TLS mode: the same port also answers https with a certificate from the GUI's own
   *  local CA (server/tls), so passkeys work from a phone. Needs `openssl`. */
  tls?: boolean;
  /** The `.local` name the certificate and the rp id are made for (tests); default from os.hostname(). */
  tlsHostname?: string;
  /** Loopback-only test door for the conformance runner. */
  testDoor?: boolean;
  /** Where the built web app is; default: dist/web beside the bundle. */
  webDir?: string;
  /** Stop the console banner (tests). */
  quiet?: boolean;
  /** Store timer period (tests). */
  tickMs?: number;
  /** Where installed themes live; default <stateDir>/themes. */
  themesDir?: string;
}

export interface App {
  /** The plain-http server; with TLS on, one of the two behind `listener`. */
  server: http.Server;
  /** The https server when TLS mode is on. */
  httpsServer: https.Server | null;
  /** What is bound to the port: the dual-protocol listener with TLS on, `server` otherwise. */
  listener: net.Server;
  /** The certificates in use, or null. */
  tls: TlsMaterial | null;
  router: Router;
  store: Store;
  control: Control;
  port: number;
  /** http://127.0.0.1:<port> */
  url: string;
  /** http://<lan ip>:<port> for every LAN address, most likely first. */
  lanUrls: string[];
  stateDir: string;
  config: () => GuiConfig;
  info: () => Info;
  outbox: OutboxSource | null;
  themes: ThemeRegistry;
  close(): Promise<void>;
}

export async function createApp(opts: AppOptions = {}): Promise<App> {
  const startedAt = new Date().toISOString();
  const stateDir = opts.stateDir ?? defaultStateDir();
  let config = readGuiConfig(stateDir);
  const store = new Store(stateDir, { tickMs: opts.tickMs });
  const router = new Router();
  let port = opts.port ?? DEFAULT_PORT;
  const tls: TlsMaterial | null = opts.tls
    ? ensureCerts(path.join(stateDir, "tls"), { hostname: opts.tlsHostname, addresses: lanAddresses() })
    : null;
  const rpId = opts.rpId ?? tls?.hostname ?? "localhost";
  const uiKey = (): string => config.uiKey;
  const uiAuth = uiAuthFor(uiKey);

  const control = createControl({
    stateDir,
    sinkToken: () => config.sinkToken,
    rpId,
    testDoor: opts.testDoor ?? false,
    uiAuth,
    sessionExists: (key) => store.sessionExists(key),
  });

  registerReceiver(router, { store, sinkToken: () => config.sinkToken, control });
  control.register(router);

  let outbox: OutboxSource | null = null;
  if (opts.outbox !== false) {
    try {
      outbox = startOutboxSource(store, { path: opts.outboxPath });
    } catch (e) {
      if (!opts.quiet) process.stderr.write(`[sessionpipe-gui] outbox: ${(e as Error).message}\n`);
    }
  }

  let demo: Runner | null = null;
  const setDemo = (on: boolean): void => {
    if (on && !demo) demo = startDemo(store, { speed: opts.speed });
    else if (!on && demo) {
      demo.stop();
      demo = null;
    }
  };
  if (opts.demo) setDemo(true);
  let replay: Runner | null = null;
  if (opts.replay) replay = startReplay(store, opts.replay, { speed: opts.speed ?? 0, rebase: true, maxGapMs: 10_000 });

  const lanUrls = (): string[] => lanAddresses().map((ip) => `http://${ip}:${port}`);
  const httpsUrl = (): string | undefined => (tls ? `https://${tls.hostname}:${port}` : undefined);
  const info = (): Info => {
    const lan = lanUrls();
    const base = lan[0] ?? `http://127.0.0.1:${port}`;
    const stats = store.stats();
    const ob = outbox?.status();
    return {
      name: "sessionpipe-gui",
      version: packageVersion(),
      startedAt,
      port,
      urls: { local: `http://localhost:${port}`, lan, ...(tls ? { https: httpsUrl()! } : {}) },
      sinkCommand: `sessionpipe sink add ${base} --tier 3 --token ${config.sinkToken}`,
      sinkToken: config.sinkToken,
      uiKey: config.uiKey,
      sources: {
        http: true,
        outbox: ob ? { path: ob.path, sessions: ob.sessions, enabled: true, events: ob.events } : null,
        demo: demo !== null,
      },
      storage: { dir: stateDir, bytes: stats.storageBytes },
      wellKnown: wellKnown(control),
      control: { enabled: true, rpId, machines: control.machines().size },
      ...(tls
        ? {
            tls: {
              on: true,
              hostname: tls.hostname,
              httpsUrl: httpsUrl()!,
              caUrl: `${base}${ROUTES.caCert}`,
              caFingerprint: tls.caFingerprint,
              expiresAt: tls.serverExpiresAt,
            },
          }
        : {}),
    };
  };

  registerUi(router, {
    colorThemesDir: path.join(stateDir, "color-themes"),
    store,
    control,
    uiKey,
    info,
    rotateSinkToken: () => {
      config = rotateSinkToken(stateDir, config);
      return config.sinkToken;
    },
    demo: { on: () => demo !== null, set: setDemo },
  });
  const themes = new ThemeRegistry(opts.themesDir ?? path.join(stateDir, "themes"));
  registerThemes(router, { registry: themes, uiAuth, stateDir: path.join(stateDir, "themes-state") });
  registerTrust(router, { uiAuth, uiKey, tls: () => tls, info });
  router.fallback = staticFiles(opts.webDir ?? webDir(), { uiAuth, uiKey });

  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => void router.handle(req, res);
  const server = http.createServer(handler);
  server.keepAliveTimeout = 65_000;
  let httpsServer: https.Server | null = null;
  let listener: net.Server = server;
  if (tls) {
    httpsServer = https.createServer({ key: tls.key, cert: tls.cert, minVersion: "TLSv1.2" }, handler);
    httpsServer.keepAliveTimeout = 65_000;
    listener = createDualListener({ http: server, https: httpsServer });
  }
  const host = opts.host ?? "0.0.0.0";
  port = await listen(listener, opts.port ?? DEFAULT_PORT, host);

  return {
    server,
    httpsServer,
    listener,
    tls,
    router,
    store,
    control,
    port,
    url: `http://127.0.0.1:${port}`,
    get lanUrls() {
      return lanUrls();
    },
    stateDir,
    config: () => config,
    info,
    outbox,
    themes,
    close: async () => {
      outbox?.stop();
      setDemo(false);
      replay?.stop();
      control.close();
      await store.close();
      server.closeAllConnections?.();
      httpsServer?.closeAllConnections?.();
      if (listener !== server) (listener as DualListener).destroyConnections();
      await new Promise<void>((r) => listener.close(() => r()));
      if (listener !== server) await new Promise<void>((r) => server.close(() => r()));
      if (httpsServer) await new Promise<void>((r) => httpsServer!.close(() => r()));
    },
  };
}

export { ROUTES };
