// SPDX-License-Identifier: Apache-2.0
// GET /api/ui/stream: Server-Sent Events. The first frame is a snapshot, then every
// store message and every control message as it happens, and a `: ping` comment
// every 15 s so proxies and phones keep the connection.
import type { Snapshot, StreamMessage } from "../../shared/api.js";
import type { Control } from "../control/index.js";
import type { Ctx } from "../http/router.js";
import type { Store } from "../store/store.js";

export const PING_MS = 15_000;

export interface StreamDeps {
  store: Store;
  control: Control;
  snapshot: () => Snapshot;
  pingMs?: number;
}

export function serveStream(ctx: Ctx, deps: StreamDeps): void {
  const { req, res } = ctx;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();
  const write = (msg: StreamMessage): void => {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${msg.kind}\ndata: ${JSON.stringify(msg)}\n\n`);
  };
  write({ kind: "snapshot", snapshot: deps.snapshot() });
  const offStore = deps.store.subscribe((m) => {
    if (m.kind === "machine") {
      const control = deps.control.machines().get(m.machine.name);
      write({ kind: "machine", machine: control ? { ...m.machine, control } : m.machine });
    } else write(m);
  });
  const offControl = deps.control.subscribe(write);
  const ping = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
  }, deps.pingMs ?? PING_MS);
  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    clearInterval(ping);
    offStore();
    offControl();
    if (!res.writableEnded) res.end();
  };
  res.on("close", cleanup);
  req.on("close", cleanup);
  req.on("error", cleanup);
}
