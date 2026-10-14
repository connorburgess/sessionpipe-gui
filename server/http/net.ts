// SPDX-License-Identifier: Apache-2.0
import os from "node:os";

export function isLoopback(ip: string): boolean {
  const v = ip.replace(/^::ffff:/, "");
  return v === "127.0.0.1" || v === "::1" || v.startsWith("127.");
}

/** IPv4 addresses of this machine on its networks, most likely LAN first. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (/^(docker|br-|veth|utun|vmnet|bridge)/.test(name)) out.push(a.address);
      else out.unshift(a.address);
    }
  }
  return out;
}
