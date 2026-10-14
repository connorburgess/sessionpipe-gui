// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. Where the GUI keeps its own state, and the two secrets it
// makes on first run: the sink token (what senders present) and the UI key (what a
// phone presents). Both live in <stateDir>/config.json, mode 0600.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface GuiConfig {
  sinkToken: string;
  uiKey: string;
  createdAt: string;
  /** TLS mode on by default (`--tls` persists true, `--no-tls` false); absent = off. */
  tls?: boolean;
}

export function defaultStateDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  return (
    process.env.SESSIONPIPE_GUI_STATE ??
    (xdg ? path.join(xdg, "sessionpipe-gui") : path.join(os.homedir(), ".local", "state", "sessionpipe-gui"))
  );
}

export const newSinkToken = (): string => `spg_${randomBytes(24).toString("base64url")}`;
export const newUiKey = (): string => randomBytes(12).toString("base64url");

/** Read the config, making it (or any missing secret) on first run. */
export function readGuiConfig(dir: string): GuiConfig {
  const f = path.join(dir, "config.json");
  let cfg: Partial<GuiConfig> = {};
  if (existsSync(f)) {
    try {
      cfg = JSON.parse(readFileSync(f, "utf8")) as Partial<GuiConfig>;
    } catch {
      cfg = {};
    }
  }
  const complete = typeof cfg.sinkToken === "string" && cfg.sinkToken && typeof cfg.uiKey === "string" && cfg.uiKey;
  const full: GuiConfig = {
    sinkToken: typeof cfg.sinkToken === "string" && cfg.sinkToken ? cfg.sinkToken : newSinkToken(),
    uiKey: typeof cfg.uiKey === "string" && cfg.uiKey ? cfg.uiKey : newUiKey(),
    createdAt: typeof cfg.createdAt === "string" ? cfg.createdAt : new Date().toISOString(),
  };
  if (typeof cfg.tls === "boolean") full.tls = cfg.tls;
  if (!complete) writeGuiConfig(dir, full);
  return full;
}

export function writeGuiConfig(dir: string, cfg: GuiConfig): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

/** A new sink token, written; the old one stops working at once. */
export function rotateSinkToken(dir: string, cfg: GuiConfig): GuiConfig {
  const next = { ...cfg, sinkToken: newSinkToken() };
  writeGuiConfig(dir, next);
  return next;
}

/** Remember `--tls` / `--no-tls`, so a plain `npx sessionpipe-gui` keeps the choice. */
export function setTlsPreference(dir: string, cfg: GuiConfig, on: boolean): GuiConfig {
  const next = { ...cfg, tls: on };
  if (cfg.tls !== on) writeGuiConfig(dir, next);
  return next;
}

/** This package's version, from package.json beside dist/ (or the repo root from source). */
export function packageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const c of [path.join(here, "..", "package.json"), path.join(here, "..", "..", "package.json")]) {
    try {
      const pkg = JSON.parse(readFileSync(c, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "sessionpipe-gui" && typeof pkg.version === "string") return pkg.version;
    } catch {}
  }
  return "0.0.0";
}
