// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core (composition root). Every module plugs in here and nowhere
// else. Module boundaries and who owns what: ARCHITECTURE.md.
import http from "node:http";
import { DEFAULT_PORT } from "../shared/api.js";
import { defaultStateDir, readGuiConfig } from "./config.js";
import { Router } from "./http/router.js";
import { Store } from "./store/store.js";

export interface AppOptions {
  port?: number;
  host?: string;
  stateDir?: string;
  /** Tail the local sessionpipe outbox (zero-config on the machine that runs agents). */
  outbox?: boolean;
  /** Generate synthetic sessions so the board is never empty. */
  demo?: boolean;
  /** The rp id control passkeys are made for (CONTROL.md §2); "localhost" by default. */
  rpId?: string;
  /** Stop the console banner (tests). */
  quiet?: boolean;
}

export interface App {
  server: http.Server;
  router: Router;
  store: Store;
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function createApp(opts: AppOptions = {}): Promise<App> {
  const stateDir = opts.stateDir ?? defaultStateDir();
  const config = readGuiConfig(stateDir);
  const store = new Store(stateDir);
  const router = new Router();

  // registerReceiver(router, { store, config })      — server-core
  // registerControl(router, { stateDir, config })    — control
  // registerUi(router, { store, config, ... })       — server-core
  // startOutboxSource(store)                         — server-core
  // startDemo(store)                                 — demo
  // router.fallback = staticFiles(distWeb)           — server-core
  void config;

  const server = http.createServer((req, res) => void router.handle(req, res));
  const host = opts.host ?? "0.0.0.0";
  const port = await new Promise<number>((resolve, reject) => {
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
    port,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await store.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
