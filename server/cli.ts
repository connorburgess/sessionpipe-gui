// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. STUB — `npx sessionpipe-gui [--port N] [--no-outbox] [--demo]
// [--state DIR] [--rp-id HOST]`. Replace wholesale; the real one prints the LAN URL,
// a QR code and the `sessionpipe sink add` line.
import { createApp } from "./app.js";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const app = await createApp({
  port: flag("--port") ? Number(flag("--port")) : undefined,
  outbox: !args.includes("--no-outbox"),
  demo: args.includes("--demo"),
  stateDir: flag("--state"),
  rpId: flag("--rp-id"),
});
process.stdout.write(`sessionpipe-gui listening on ${app.url}\n`);
