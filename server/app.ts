// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core (composition root). Every module plugs in here and nowhere
// else. Module boundaries and who owns what: ARCHITECTURE.md.
import http from "node:http";
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
  /** The rp id control passkeys are made for (CONTROL.md §2); "localhost" by default. */
  rpId?: string;
  /** Loopback-only test door for the conformance runner. */
  testDoor?: boolean;
  /** Where the built web app is; default: dist/web beside the bundle. */
  webDir?: string;
  /** Stop the console banner (tests). */
  quiet?: boolean;
  /** Store timer period (tests). */
  tickMs?: number;
}

export interface App {
  server: http.Server;
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
  close(): Promise<void>;
}

export async function createApp(opts: AppOptions = {}): Promise<App> {
  const startedAt = new Date().toISOString();
  const stateDir = opts.stateDir ?? defaultStateDir();
  let config = readGuiConfig(stateDir);
  const store = new Store(stateDir, { tickMs: opts.tickMs });
  const router = new Router();
  const rpId = opts.rpId ?? "localhost";
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

  let port = opts.port ?? DEFAULT_PORT;
  const lanUrls = (): string[] => lanAddresses().map((ip) => `http://${ip}:${port}`);
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
      urls: { local: `http://localhost:${port}`, lan },
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
    };
  };

  registerUi(router, {
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
  router.fallback = staticFiles(opts.webDir ?? webDir(), { uiAuth, uiKey });

  const server = http.createServer((req, res) => void router.handle(req, res));
  server.keepAliveTimeout = 65_000;
  const host = opts.host ?? "0.0.0.0";
  port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_PORT, host, () => {
      const a = server.address();
      resolve(typeof a === "object" && a ? a.port : (opts.port ?? DEFAULT_PORT));
    });
  });

  return {
    server,
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
    close: async () => {
      outbox?.stop();
      setDemo(false);
      replay?.stop();
      control.close();
      await store.close();
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export { ROUTES };
