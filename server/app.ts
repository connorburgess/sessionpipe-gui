// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core (composition root). Every module plugs in here and nowhere
// else. Module boundaries and who owns what: ARCHITECTURE.md.
import http from "node:http";
import https from "node:https";
import type net from "node:net";
import path from "node:path";
import { DEFAULT_PORT, type Info, ROUTES } from "../shared/api.js";
import {
  defaultStateDir,
  type GuiConfig,
  packageVersion,
  readGuiConfig,
  rotateSinkToken,
  setTlsPreference,
} from "./config.js";
import { type Control, createControl } from "./control/index.js";
import { type Runner, startDemo, startReplay } from "./demo/index.js";
import { lanAddresses } from "./http/net.js";
import { Router } from "./http/router.js";
import { registerReceiver, wellKnown } from "./receiver/index.js";
import { registerSetup } from "./setup/index.js";
import { type OutboxSource, startOutboxSource } from "./sources/outbox.js";
import { staticFiles, webDir } from "./static.js";
import { Store } from "./store/store.js";
import { registerThemes, ThemeRegistry } from "./themes/index.js";
import { ensureCerts, type TlsMaterial } from "./tls/certs.js";
import { createDualListener, type DualListener, listen } from "./tls/listen.js";
import { registerTrust } from "./tls/trust.js";
import { uiAuthFor } from "./ui/auth.js";
import { registerUi } from "./ui/index.js";
import { ViewerRegistry } from "./ui/viewers.js";

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
  /** The plain-http server, one of the two behind `listener`. */
  server: http.Server;
  /** The https server when TLS mode is on (at boot, or turned on while running). */
  readonly httpsServer: https.Server | null;
  /** What is bound to the port: the dual-protocol listener (http always; https once TLS mode is on). */
  listener: net.Server;
  /** The certificates in use, or null. */
  readonly tls: TlsMaterial | null;
  /** The WebAuthn rp id right now ("localhost", or `<name>.local` with TLS mode). */
  readonly rpId: string;
  /** Turn TLS mode on without a restart: certificates made if needed, the https side
   *  attached to the running listener, the rp id switched, `tls: true` remembered.
   *  Throws TlsError (no openssl). A no-op when already on. */
  enableTls(): TlsMaterial;
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
  let tls: TlsMaterial | null = opts.tls
    ? ensureCerts(path.join(stateDir, "tls"), { hostname: opts.tlsHostname, addresses: lanAddresses() })
    : null;
  let rpId = opts.rpId ?? tls?.hostname ?? "localhost";
  const uiKey = (): string => config.uiKey;
  const uiAuth = uiAuthFor(uiKey);

  const control = createControl({
    stateDir,
    sinkToken: () => config.sinkToken,
    rpId: () => rpId,
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
  /** Synthetic sessions never outlive demo mode: turning it off (or starting without
   *  --demo) forgets every session the generator wrote. */
  const dropDemoSessions = (): number => {
    let n = 0;
    for (const s of store.snapshot().sessions) if (s.source === "demo" && store.forget(s.key)) n++;
    return n;
  };
  const setDemo = (on: boolean): void => {
    if (on && !demo) demo = startDemo(store, { speed: opts.speed });
    else if (!on && demo) {
      demo.stop();
      demo = null;
      dropDemoSessions();
    }
  };
  if (opts.demo) setDemo(true);
  else {
    const dropped = dropDemoSessions();
    if (dropped && !opts.quiet)
      process.stderr.write(`[sessionpipe-gui] forgot ${dropped} demo session(s) left from an earlier run\n`);
  }
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

  const viewers = new ViewerRegistry();
  registerUi(router, {
    colorThemesDir: path.join(stateDir, "color-themes"),
    store,
    control,
    uiKey,
    info,
    viewers,
    rotateSinkToken: () => {
      config = rotateSinkToken(stateDir, config);
      return config.sinkToken;
    },
    demo: { on: () => demo !== null, set: setDemo },
  });
  const themes = new ThemeRegistry(opts.themesDir ?? path.join(stateDir, "themes"));
  registerThemes(router, { registry: themes, uiAuth, stateDir: path.join(stateDir, "themes-state") });
  registerTrust(router, { uiAuth, uiKey, tls: () => tls, info });

  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => void router.handle(req, res);
  const server = http.createServer(handler);
  server.keepAliveTimeout = 65_000;
  const makeHttps = (m: TlsMaterial): https.Server => {
    const s = https.createServer({ key: m.key, cert: m.cert, minVersion: "TLSv1.2" }, handler);
    s.keepAliveTimeout = 65_000;
    return s;
  };
  let httpsServer: https.Server | null = tls ? makeHttps(tls) : null;
  // One listener for both protocols, always: the https side can then be attached while
  // running (the setup page's "Turn on"), without rebinding the port.
  const listener: DualListener = createDualListener({ http: server, https: httpsServer });
  const enableTls = (): TlsMaterial => {
    if (tls) return tls;
    const m = ensureCerts(path.join(stateDir, "tls"), { hostname: opts.tlsHostname, addresses: lanAddresses() });
    httpsServer = makeHttps(m);
    listener.setHttps(httpsServer);
    tls = m;
    rpId = opts.rpId ?? m.hostname;
    config = setTlsPreference(stateDir, config, true);
    return m;
  };

  const setup = registerSetup(router, {
    store,
    control,
    info,
    viewers,
    tls: () => tls,
    enableTls,
    sinkToken: () => config.sinkToken,
    port: () => port,
    outbox,
    outboxPath: opts.outboxPath,
    testDoor: opts.testDoor ?? false,
  });
  router.fallback = staticFiles(opts.webDir ?? webDir(), { uiAuth, uiKey });

  const host = opts.host ?? "0.0.0.0";
  port = await listen(listener, opts.port ?? DEFAULT_PORT, host);

  return {
    server,
    get httpsServer() {
      return httpsServer;
    },
    listener,
    get tls() {
      return tls;
    },
    get rpId() {
      return rpId;
    },
    enableTls,
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
      setup.pairer.close();
      outbox?.stop();
      setDemo(false);
      replay?.stop();
      control.close();
      await store.close();
      server.closeAllConnections?.();
      httpsServer?.closeAllConnections?.();
      listener.destroyConnections();
      await new Promise<void>((r) => listener.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      if (httpsServer) await new Promise<void>((r) => httpsServer!.close(() => r()));
    },
  };
}

export { ROUTES };
