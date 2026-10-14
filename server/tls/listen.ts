// SPDX-License-Identifier: Apache-2.0
// Owned by: tls. One port, both protocols: a net.Server reads the first byte of every
// connection and hands the socket to the https server when it is a TLS ClientHello
// (0x16), to the http server otherwise. Both share one request handler, so
// http://localhost:7373 (the daemon, the sinks, the trust page) and
// https://<name>.local:7373 (passkeys from a phone) are the same board on 7373.
import type http from "node:http";
import type https from "node:https";
import net from "node:net";

export interface DualServers {
  http: http.Server;
  /** Absent or null until TLS mode is on; `setHttps` attaches one at runtime. */
  https?: https.Server | null;
}

const TLS_HANDSHAKE = 0x16;

export interface DualListener extends net.Server {
  /** Destroy every open connection, both protocols (shutdown). */
  destroyConnections(): void;
  /** Attach (or detach) the https server while listening: the setup page turns TLS mode
   *  on without a restart. A ClientHello with no https server goes to http, as before. */
  setHttps(server: https.Server | null): void;
  /** The https server attached right now. */
  readonly https: https.Server | null;
}

/** A listener that routes by the first byte. Call `listen(listener, port, host)` on it. */
export function createDualListener(servers: DualServers): DualListener {
  const open = new Set<net.Socket>();
  const listener = net.createServer({ pauseOnConnect: true }, (socket) => {
    open.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => open.delete(socket));
    socket.once("data", (chunk: Buffer) => {
      socket.pause();
      socket.unshift(chunk);
      const target = chunk[0] === TLS_HANDSHAKE && servers.https ? servers.https : servers.http;
      target.emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
    socket.resume();
  }) as DualListener;
  // The inner servers never listen themselves; node sets up their connection tracking
  // (headersTimeout, requestTimeout, closeAllConnections) on their `listening` event.
  listener.once("listening", () => {
    servers.http.emit("listening");
    servers.https?.emit("listening");
  });
  listener.destroyConnections = () => {
    for (const s of open) s.destroy();
    open.clear();
  };
  listener.setHttps = (server) => {
    servers.https = server;
    if (server && listener.listening) server.emit("listening");
  };
  Object.defineProperty(listener, "https", { get: () => servers.https ?? null });
  return listener;
}

/** Bind `listener` and resolve with the port it got (0 picks one). */
export function listen(listener: net.Server, port: number, host: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, host, () => {
      const a = listener.address();
      resolve(typeof a === "object" && a ? a.port : port);
    });
  });
}
