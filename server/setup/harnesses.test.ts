// SPDX-License-Identifier: Apache-2.0
// The registry's harnesses as seen on a fake disk: installed with sessionpipe's hooks on,
// installed with them off, not installed, and the M7 rows sessionpipe has no adapter for
// yet (shown as unsupported until a hooks file names it). Then the store's counts per
// harness, this machine's only, and the detector's ten-second cache.
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { HarnessStatus } from "../../shared/api.js";
import {
  claudeConfigDirs,
  createHarnessDetector,
  type HarnessFs,
  type HarnessProbe,
  harnessStatuses,
  onPath,
  probeHarnesses,
} from "./harnesses.js";

const HOME = "/home/u";

/** A disk from a map of paths: a string is a file, null a directory. Parents of every entry exist. */
function fakeFs(entries: Record<string, string | null>, env: NodeJS.ProcessEnv = {}): HarnessFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  for (const [p, v] of Object.entries(entries)) {
    if (v === null) dirs.add(p);
    else files.set(p, v);
    for (let d = path.dirname(p); d !== path.dirname(d); d = path.dirname(d)) dirs.add(d);
  }
  return {
    home: HOME,
    env,
    platform: "linux",
    exists: (p) => files.has(p) || dirs.has(p),
    isDir: (p) => dirs.has(p),
    readFile: (p) => files.get(p) ?? null,
    listDir: (p) =>
      [...files.keys(), ...dirs].filter((q) => path.dirname(q) === p && q !== p).map((q) => path.basename(q)),
  };
}

type Name =
  | "claude-code"
  | "codex"
  | "gemini-cli"
  | "antigravity"
  | "cursor"
  | "copilot-cli"
  | "droid"
  | "kiro"
  | "opencode";
const byName = (fs: HarnessFs) =>
  Object.fromEntries(probeHarnesses(fs).map((p) => [p.name, p])) as Record<Name, HarnessProbe>;

describe("harness probes", () => {
  it("lists the whole registry, none installed on an empty disk", () => {
    const all = probeHarnesses(fakeFs({}));
    expect(all.map((p) => p.name)).toEqual([
      "claude-code",
      "codex",
      "gemini-cli",
      "antigravity",
      "cursor",
      "copilot-cli",
      "droid",
      "kiro",
      "opencode",
    ]);
    expect(all.every((p) => !p.installed)).toBe(true);
    // Without an install, M2 rows are "off", M7 rows "unsupported".
    expect(all.find((p) => p.name === "gemini-cli")?.hooks).toBe("off");
    expect(all.find((p) => p.name === "kiro")?.hooks).toBe("unsupported");
  });

  it("installed with the hooks on: Claude Code's settings.json, Antigravity's top-level key, Codex's notify", () => {
    const hooks = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: '"/usr/bin/node" "/x/node_modules/sessionpipe/dist/hook.js" claude-code Stop',
              },
            ],
          },
        ],
      },
    });
    const h = byName(
      fakeFs({
        [`${HOME}/.claude/settings.json`]: hooks,
        [`${HOME}/.gemini/config/hooks.json`]: JSON.stringify({ sessionpipe: { enabled: true, Stop: [] } }),
        [`${HOME}/.gemini/antigravity`]: null,
        [`${HOME}/.codex/config.toml`]:
          'notify = ["/usr/bin/node", "/x/dist/notify.js", "sessionpipe"]\n[projects."/a"]\n',
      }),
    );
    expect(h["claude-code"]).toMatchObject({
      installed: true,
      hooks: "on",
      configPath: `${HOME}/.claude/settings.json`,
    });
    expect(h.antigravity).toMatchObject({
      installed: true,
      hooks: "on",
      configPath: `${HOME}/.gemini/config/hooks.json`,
    });
    expect(h.codex).toMatchObject({ installed: true, hooks: "on" });
  });

  it("installed with the hooks off: a config dir or settings without sessionpipe in it", () => {
    const h = byName(
      fakeFs({
        [`${HOME}/.codex/config.toml`]: 'model = "gpt-5-codex"\n',
        [`${HOME}/.gemini/settings.json`]: JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "other" }] }] } }),
        [`${HOME}/.claude/projects`]: null,
      }),
    );
    expect(h.codex).toMatchObject({ installed: true, hooks: "off" });
    expect(h["gemini-cli"]).toMatchObject({ installed: true, hooks: "off" });
    expect(h["claude-code"]).toMatchObject({ installed: true, hooks: "off" });
    // A notify line inside a table is misplaced and does not count (ADAPTERS.md).
    const misplaced = byName(fakeFs({ [`${HOME}/.codex/config.toml`]: '[projects."/a"]\nnotify = ["sessionpipe"]\n' }));
    expect(misplaced.codex.hooks).toBe("off");
  });

  it("not installed: nothing of it on the disk or the PATH", () => {
    const h = byName(fakeFs({ [`${HOME}/.codex`]: null }, { PATH: "/usr/bin" }));
    expect(h["claude-code"]).toMatchObject({ installed: false, hooks: "off" });
    expect(h.antigravity).toMatchObject({ installed: false });
    expect(h.cursor).toMatchObject({ installed: false, hooks: "unsupported" });
  });

  it("unsupported: Cursor and the other M7 rows are installed but pending, until a hooks file names sessionpipe", () => {
    const h = byName(
      fakeFs({
        [`${HOME}/.cursor/hooks.json`]: JSON.stringify({ version: 1, hooks: { stop: [{ command: "other" }] } }),
        [`${HOME}/.factory`]: null,
        [`${HOME}/.kiro/hooks/sessionpipe.json`]: "{}",
        [`${HOME}/.config/opencode`]: null,
      }),
    );
    expect(h.cursor).toMatchObject({ installed: true, hooks: "unsupported", configPath: `${HOME}/.cursor/hooks.json` });
    expect(h.droid).toMatchObject({ installed: true, hooks: "unsupported" });
    expect(h.opencode).toMatchObject({ installed: true, hooks: "unsupported" });
    expect(h.kiro).toMatchObject({ installed: true, hooks: "on" });
    const cursorOn = byName(
      fakeFs({
        [`${HOME}/.cursor/hooks.json`]: JSON.stringify({
          version: 1,
          hooks: { stop: [{ command: "node hook.js cursor" }] },
        }),
      }),
    );
    expect(cursorOn.cursor.hooks).toBe("unsupported");
    const cursorSp = byName(
      fakeFs({
        [`${HOME}/.cursor/hooks.json`]: JSON.stringify({ hooks: { stop: [{ command: "/x/sessionpipe/hook.js" }] } }),
      }),
    );
    expect(cursorSp.cursor.hooks).toBe("on");
  });

  it("finds commands on the PATH and the app bundle on macOS", () => {
    const fs = fakeFs({ "/opt/bin/claude": "", "/opt/bin/agy": "" }, { PATH: "/nowhere:/opt/bin" });
    expect(onPath(fs, "claude")).toBe(true);
    expect(onPath(fs, "codex")).toBe(false);
    const h = byName(fs);
    expect(h["claude-code"].installed).toBe(true);
    expect(h.antigravity.installed).toBe(true);
    const mac = { ...fakeFs({ "/Applications/Cursor.app": null }), platform: "darwin" as const };
    expect(byName(mac).cursor.installed).toBe(true);
    expect(byName({ ...mac, platform: "linux" }).cursor.installed).toBe(false);
  });

  it("Claude Code's config dirs: ~/.claude, $CLAUDE_CONFIG_DIR, ~/.claude-* with projects/ or settings.json", () => {
    const fs = fakeFs(
      {
        [`${HOME}/.claude`]: null,
        [`${HOME}/.claude-work/settings.json`]: JSON.stringify({ hooks: { Stop: [{ command: "sessionpipe" }] } }),
        [`${HOME}/.claude-old`]: null,
        "/etc/claude-cfg": null,
      },
      { CLAUDE_CONFIG_DIR: "/etc/claude-cfg" },
    );
    expect(claudeConfigDirs(fs)).toEqual([`${HOME}/.claude`, "/etc/claude-cfg", `${HOME}/.claude-work`]);
    // Hooks written to any one of them count as on.
    expect(byName(fs)["claude-code"].hooks).toBe("on");
  });
});

describe("harness statuses", () => {
  const probes = probeHarnesses(fakeFs({ [`${HOME}/.claude`]: null, [`${HOME}/.codex`]: null }));
  const sessions = [
    { harness: "claude-code", lastAt: "2026-10-15T10:00:00.000Z", machine: "box" },
    { harness: "claude-code", lastAt: "2026-10-15T11:00:00.000Z", machine: "box" },
    { harness: "claude-code", lastAt: "2026-10-15T12:00:00.000Z", machine: "elsewhere" },
    { harness: "codex", lastAt: "2026-10-15T09:00:00.000Z", machine: undefined },
  ];

  it("counts this machine's sessions per harness and keeps the latest event", () => {
    const st = Object.fromEntries(
      harnessStatuses(probes, sessions, (m) => m === "box").map((h) => [h.name, h]),
    ) as Record<Name, HarnessStatus>;
    expect(st["claude-code"]).toMatchObject({ sessions: 2, lastEventAt: "2026-10-15T11:00:00.000Z" });
    // A session with no machine on it yet counts.
    expect(st.codex).toMatchObject({ sessions: 1, lastEventAt: "2026-10-15T09:00:00.000Z" });
    expect(st["gemini-cli"]).toMatchObject({ sessions: 0 });
    expect(st["gemini-cli"].lastEventAt).toBeUndefined();
    // Without a machine filter every session counts.
    expect(harnessStatuses(probes, sessions).find((h) => h.name === "claude-code")?.sessions).toBe(3);
  });

  it("the detector reads the disk once per ten seconds, the store every time", () => {
    const entries: Record<string, string | null> = {};
    let reads = 0;
    const fs = fakeFs(entries);
    const counting: HarnessFs = {
      ...fs,
      isDir: (p) => {
        reads++;
        return fs.isDir(p);
      },
    };
    const d = createHarnessDetector(counting);
    const a = d.statuses([], undefined, 1000);
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    expect(a.find((h) => h.name === "codex")?.sessions).toBe(0);
    const b = d.statuses([{ harness: "codex", lastAt: "2026-10-15T09:00:00.000Z" }], undefined, 5000);
    expect(reads).toBe(afterFirst);
    expect(b.find((h) => h.name === "codex")?.sessions).toBe(1);
    d.statuses([], undefined, 12_000);
    expect(reads).toBeGreaterThan(afterFirst);
    const before = reads;
    d.invalidate();
    d.statuses([], undefined, 12_001);
    expect(reads).toBeGreaterThan(before);
  });
});
