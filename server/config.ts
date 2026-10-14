// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. Where the GUI keeps its own state, and the two secrets it
// makes on first run: the sink token (what senders present) and the UI key (what a
// phone presents). Replace this stub wholesale.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface GuiConfig {
  sinkToken: string;
  uiKey: string;
  createdAt: string;
}

export function defaultStateDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  return (
    process.env.SESSIONPIPE_GUI_STATE ??
    (xdg ? path.join(xdg, "sessionpipe-gui") : path.join(os.homedir(), ".local", "state", "sessionpipe-gui"))
  );
}

export function readGuiConfig(dir: string): GuiConfig {
  const f = path.join(dir, "config.json");
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")) as GuiConfig;
  const cfg: GuiConfig = {
    sinkToken: `spg_${randomBytes(24).toString("base64url")}`,
    uiKey: randomBytes(12).toString("base64url"),
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(f, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  return cfg;
}

export function writeGuiConfig(dir: string, cfg: GuiConfig): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}
