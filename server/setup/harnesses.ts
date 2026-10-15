// SPDX-License-Identifier: Apache-2.0
// Owned by: onboarding. The harnesses of the protocol registry (sessionpipe's
// spec/ADAPTERS.md) as seen on this machine: which are installed (a config dir, an app
// bundle, a binary on the PATH), which have sessionpipe's hooks written where that
// harness reads them, and which sessionpipe has no adapter for yet. Pure: every lookup
// goes through `HarnessFs`, so tests hand in a fake disk. The status polls every two
// seconds, so the detector caches the disk's answer for ten.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessStatus, SessionSummary } from "../../shared/api.js";

export interface HarnessFs {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /** True for a file or a directory. */
  exists(p: string): boolean;
  /** Only directories, not files. */
  isDir(p: string): boolean;
  /** The file's text, or null when it cannot be read. */
  readFile(p: string): string | null;
  /** Entry names of a directory; empty when it is not one. */
  listDir(p: string): string[];
}

export const realHarnessFs = (
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): HarnessFs => ({
  home,
  env,
  platform,
  exists: (p) => existsSync(p),
  isDir: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  readFile: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  listDir: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
});

/** What the disk says, before the store adds its counts. */
export interface HarnessProbe {
  name: string;
  label: string;
  installed: boolean;
  hooks: HarnessStatus["hooks"];
  configPath: string;
}

/** Is a command on the PATH? (`.cmd`/`.exe` too on Windows.) Existence, not an exec. */
export function onPath(fs: HarnessFs, cmd: string): boolean {
  const names = fs.platform === "win32" ? [`${cmd}.cmd`, `${cmd}.exe`, cmd] : [cmd];
  for (const dir of (fs.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) if (fs.exists(path.join(dir, n))) return true;
  }
  return false;
}

const appBundle = (fs: HarnessFs, name: string): boolean =>
  fs.platform === "darwin" &&
  (fs.exists(`/Applications/${name}.app`) || fs.exists(path.join(fs.home, "Applications", `${name}.app`)));

/** Does a JSON file's `hooks` (or the whole file) name sessionpipe? A file that is not
 *  JSON is searched as text, so a hand-edited one still counts. */
function mentionsSessionpipe(text: string | null, key?: string): boolean {
  if (!text) return false;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const part = key ? j[key] : j;
    return part !== undefined && JSON.stringify(part).includes("sessionpipe");
  } catch {
    return text.includes("sessionpipe");
  }
}

/** Does a JSON file carry a top-level key (Antigravity's hooks.json names hooks by key)? */
function hasTopLevelKey(text: string | null, key: string): boolean {
  if (!text) return false;
  try {
    const j = JSON.parse(text) as unknown;
    return !!j && typeof j === "object" && key in (j as Record<string, unknown>);
  } catch {
    return text.includes(`"${key}"`);
  }
}

/** Claude Code's config dirs (ADAPTERS.md): ~/.claude, $CLAUDE_CONFIG_DIR, and any
 *  ~/.claude-* that holds projects/ or settings.json. */
export function claudeConfigDirs(fs: HarnessFs): string[] {
  const out = new Set<string>();
  const main = path.join(fs.home, ".claude");
  if (fs.isDir(main)) out.add(main);
  if (fs.env.CLAUDE_CONFIG_DIR && fs.isDir(fs.env.CLAUDE_CONFIG_DIR)) out.add(fs.env.CLAUDE_CONFIG_DIR);
  for (const entry of fs.listDir(fs.home)) {
    if (!entry.startsWith(".claude-")) continue;
    const dir = path.join(fs.home, entry);
    if (fs.isDir(path.join(dir, "projects")) || fs.exists(path.join(dir, "settings.json"))) out.add(dir);
  }
  return [...out];
}

const hooksOf = (installed: boolean, on: boolean): HarnessStatus["hooks"] => (on ? "on" : installed ? "off" : "off");
/** The M7 rows: sessionpipe has no adapter yet, unless a hooks file already names it (a
 *  branch in flight), in which case the hooks are on. */
const pendingOf = (on: boolean): HarnessStatus["hooks"] => (on ? "on" : "unsupported");

/** The registry, in ADAPTERS.md order, probed on this disk. */
export function probeHarnesses(fs: HarnessFs): HarnessProbe[] {
  const h = fs.home;
  const out: HarnessProbe[] = [];

  // Claude Code: any config dir, or the `claude` command; hooks on when any settings.json's hooks name sessionpipe.
  {
    const dirs = claudeConfigDirs(fs);
    const installed = dirs.length > 0 || onPath(fs, "claude");
    const on = dirs.some((d) => mentionsSessionpipe(fs.readFile(path.join(d, "settings.json")), "hooks"));
    out.push({
      name: "claude-code",
      label: "Claude Code",
      installed,
      hooks: hooksOf(installed, on),
      configPath: path.join(dirs[0] ?? path.join(h, ".claude"), "settings.json"),
    });
  }
  // Codex: ~/.codex; hooks.json, or the top-level `notify` in config.toml as the fallback.
  {
    const dir = path.join(h, ".codex");
    const installed = fs.isDir(dir) || onPath(fs, "codex");
    const hooksJson = path.join(dir, "hooks.json");
    // `notify` counts only at the top level of config.toml, before the first [table] (ADAPTERS.md).
    const topLevel = (fs.readFile(path.join(dir, "config.toml")) ?? "").split(/^\s*\[/m)[0] ?? "";
    const on = mentionsSessionpipe(fs.readFile(hooksJson), "hooks") || /^\s*notify\s*=.*sessionpipe/m.test(topLevel);
    out.push({ name: "codex", label: "Codex", installed, hooks: hooksOf(installed, on), configPath: hooksJson });
  }
  // Gemini CLI: ~/.gemini/settings.json or the `gemini` command; its `hooks` key.
  {
    const settings = path.join(h, ".gemini", "settings.json");
    const installed = fs.exists(settings) || onPath(fs, "gemini");
    const on = mentionsSessionpipe(fs.readFile(settings), "hooks");
    out.push({
      name: "gemini-cli",
      label: "Gemini CLI",
      installed,
      hooks: hooksOf(installed, on),
      configPath: settings,
    });
  }
  // Antigravity: a ~/.gemini/antigravity* data dir, the app bundle, or `agy`; top-level `sessionpipe` in config/hooks.json.
  {
    const hooksJson = path.join(h, ".gemini", "config", "hooks.json");
    const dataDir = fs.listDir(path.join(h, ".gemini")).some((e) => e.startsWith("antigravity"));
    const installed = dataDir || appBundle(fs, "Antigravity") || onPath(fs, "agy");
    const on = hasTopLevelKey(fs.readFile(hooksJson), "sessionpipe");
    out.push({
      name: "antigravity",
      label: "Antigravity",
      installed,
      hooks: hooksOf(installed, on),
      configPath: hooksJson,
    });
  }
  // Cursor: ~/.cursor, the app bundle, or `cursor` / `cursor-agent`. No adapter upstream yet.
  {
    const dir = path.join(h, ".cursor");
    const hooksJson = path.join(dir, "hooks.json");
    const installed = fs.isDir(dir) || appBundle(fs, "Cursor") || onPath(fs, "cursor") || onPath(fs, "cursor-agent");
    out.push({
      name: "cursor",
      label: "Cursor",
      installed,
      hooks: pendingOf(mentionsSessionpipe(fs.readFile(hooksJson), "hooks")),
      configPath: hooksJson,
    });
  }
  // The other M7 rows: their config dir says installed; their hooks file, when it exists, says on.
  const copilot = path.join(h, ".copilot", "hooks", "sessionpipe.json");
  out.push({
    name: "copilot-cli",
    label: "Copilot CLI",
    installed: fs.isDir(path.join(h, ".copilot")) || onPath(fs, "copilot"),
    hooks: pendingOf(fs.exists(copilot)),
    configPath: copilot,
  });
  const droid = path.join(h, ".factory", "hooks.json");
  out.push({
    name: "droid",
    label: "Droid",
    installed: fs.isDir(path.join(h, ".factory")) || onPath(fs, "droid"),
    hooks: pendingOf(mentionsSessionpipe(fs.readFile(droid), "hooks")),
    configPath: droid,
  });
  const kiro = path.join(h, ".kiro", "hooks", "sessionpipe.json");
  out.push({
    name: "kiro",
    label: "Kiro",
    installed: fs.isDir(path.join(h, ".kiro")),
    hooks: pendingOf(fs.exists(kiro)),
    configPath: kiro,
  });
  const xdg = fs.env.XDG_CONFIG_HOME || path.join(h, ".config");
  const opencodeDir = path.join(xdg, "opencode");
  const opencode = path.join(opencodeDir, "plugins", "sessionpipe.ts");
  out.push({
    name: "opencode",
    label: "OpenCode",
    installed: fs.isDir(opencodeDir) || onPath(fs, "opencode"),
    hooks: pendingOf(fs.exists(opencode)),
    configPath: opencode,
  });
  return out;
}

/** The probes plus the store: this machine's sessions per harness and their latest event.
 *  `mine` says whether a session's machine name is this machine (a session with no
 *  machine on it counts, as the outbox's do before their first session block). */
export function harnessStatuses(
  probes: HarnessProbe[],
  sessions: Iterable<Pick<SessionSummary, "harness" | "lastAt" | "machine">>,
  mine: (machine: string | undefined) => boolean = () => true,
): HarnessStatus[] {
  const counts = new Map<string, { n: number; last?: string }>();
  for (const s of sessions) {
    if (s.machine && !mine(s.machine)) continue;
    const c = counts.get(s.harness) ?? { n: 0 };
    c.n++;
    if (!c.last || s.lastAt > c.last) c.last = s.lastAt;
    counts.set(s.harness, c);
  }
  return probes.map((p) => {
    const c = counts.get(p.name);
    return { ...p, sessions: c?.n ?? 0, ...(c?.last ? { lastEventAt: c.last } : {}) };
  });
}

export const HARNESS_CACHE_MS = 10_000;

/** `probeHarnesses` with the disk's answer kept for `ttlMs`; the store's part is fresh every call. */
export function createHarnessDetector(fs: HarnessFs, ttlMs = HARNESS_CACHE_MS) {
  let cached: { at: number; probes: HarnessProbe[] } | null = null;
  return {
    probes(now = Date.now()): HarnessProbe[] {
      if (!cached || now - cached.at > ttlMs) cached = { at: now, probes: probeHarnesses(fs) };
      return cached.probes;
    },
    statuses(
      sessions: Iterable<Pick<SessionSummary, "harness" | "lastAt" | "machine">>,
      mine?: (machine: string | undefined) => boolean,
      now = Date.now(),
    ): HarnessStatus[] {
      return harnessStatuses(this.probes(now), sessions, mine);
    },
    /** Forget the disk's answer (after an install the page may want the truth at once). */
    invalidate() {
      cached = null;
    },
  };
}
export type HarnessDetector = ReturnType<typeof createHarnessDetector>;
