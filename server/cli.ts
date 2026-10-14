// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. `npx sessionpipe-gui`: start the receiver, print where to
// open it (with a QR code for a phone) and the one line that connects another
// machine. Ctrl-C stops it cleanly.
import { spawn } from "node:child_process";
import path from "node:path";
import QRCode from "qrcode";
import { DEFAULT_PORT, UI_KEY_PARAM } from "../shared/api.js";
import { type App, createApp } from "./app.js";
import { defaultStateDir, packageVersion } from "./config.js";
import { addTheme, formatList, linkTheme, listThemes, removeTheme, ThemeInstallError } from "./themes/index.js";

const HELP = `sessionpipe-gui ${packageVersion()} — a sessionpipe receiver with a live board

usage: sessionpipe-gui [options]

  --port N          listen on port N (default ${DEFAULT_PORT})
  --host H          bind address (default 0.0.0.0: this machine and the LAN)
  --state DIR       where events and config live (default ~/.local/state/sessionpipe-gui)
  --no-outbox       do not tail this machine's sessionpipe outbox
  --outbox DIR      tail a sessionpipe state dir other than the default one
  --demo            generate synthetic sessions so the board is never empty
  --replay FILE     replay a sessionpipe JSONL file (--speed N: 0 = at once, 1 = real time; idle gaps capped at 10 s)
  --speed N         demo / replay speed
  --rp-id HOST      WebAuthn rp id control passkeys are made for (default localhost)
  --test-door       loopback-only test door for the conformance runner
  --themes-dir DIR  where themes are installed (default <state>/themes)
  --open            open the board in the browser
  --quiet           no banner
  --version         print the version
  --help            this

themes (plugins kept outside the GUI, loaded by the page at runtime):

  sessionpipe-gui theme list                 installed themes
  sessionpipe-gui theme add <source>         install: a folder, a .tgz/.zip (path or URL),
                                             an npm package name or a git URL
  sessionpipe-gui theme link <folder>        symlink a folder, for development
  sessionpipe-gui theme remove <id>          uninstall
  --state DIR / --themes-dir DIR apply to these too.

A theme is code running in the board page with access to everything it shows:
only install themes you trust.
`;

interface Args {
  port?: number;
  host?: string;
  state?: string;
  outbox: boolean;
  outboxPath?: string;
  demo: boolean;
  replay?: string;
  speed?: number;
  rpId?: string;
  testDoor: boolean;
  open: boolean;
  quiet: boolean;
  themesDir?: string;
  /** `theme <verb> [arg]`: a subcommand instead of the server. */
  theme?: { verb: string; arg?: string };
}

function parseArgs(argv: string[]): Args | "help" | "version" {
  const a: Args = { outbox: true, demo: false, testDoor: false, open: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) fail(`${f} needs a value`);
      return v;
    };
    switch (f) {
      case "--help":
      case "-h":
        return "help";
      case "--version":
      case "-v":
        return "version";
      case "--port":
        a.port = Number(next());
        if (!Number.isInteger(a.port) || a.port < 0 || a.port > 65535) fail("--port needs a number 0–65535");
        break;
      case "--host":
        a.host = next();
        break;
      case "--state":
        a.state = next();
        break;
      case "--no-outbox":
        a.outbox = false;
        break;
      case "--outbox":
        a.outboxPath = next();
        break;
      case "--demo":
        a.demo = true;
        break;
      case "--replay":
        a.replay = next();
        break;
      case "--speed":
        a.speed = Number(next());
        if (!Number.isFinite(a.speed) || a.speed < 0) fail("--speed needs a number ≥ 0");
        break;
      case "--rp-id":
        a.rpId = next();
        break;
      case "--test-door":
        a.testDoor = true;
        break;
      case "--themes-dir":
        a.themesDir = next();
        break;
      case "theme":
        if (a.theme) fail("one theme command at a time");
        a.theme = { verb: argv[++i] ?? "" };
        if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) a.theme.arg = argv[++i];
        break;
      case "--open":
        a.open = true;
        break;
      case "--quiet":
      case "-q":
        a.quiet = true;
        break;
      default:
        fail(`unknown option ${f} (try --help)`);
    }
  }
  return a;
}

function fail(msg: string): never {
  process.stderr.write(`sessionpipe-gui: ${msg}\n`);
  process.exit(2);
}

async function banner(app: App): Promise<string> {
  const info = app.info();
  const lines: string[] = [];
  lines.push(`sessionpipe-gui ${info.version} · ${app.stateDir}`);
  lines.push("");
  lines.push(`  local   ${info.urls.local}`);
  for (const u of info.urls.lan) lines.push(`  network ${u}/?${UI_KEY_PARAM}=${info.uiKey}`);
  const phoneUrl = info.urls.lan[0] ? `${info.urls.lan[0]}/?${UI_KEY_PARAM}=${info.uiKey}` : null;
  if (phoneUrl) {
    lines.push("");
    lines.push("  on a phone, scan this (same Wi-Fi):");
    const qr = await QRCode.toString(phoneUrl, { type: "terminal", small: true });
    for (const l of qr.split("\n")) lines.push(`  ${l}`);
  }
  lines.push("  from another machine:");
  lines.push(`    ${info.sinkCommand}`);
  lines.push("");
  if (info.sources.outbox) {
    lines.push(`  outbox  tailing ${info.sources.outbox.path} (${info.sources.outbox.sessions} sessions)`);
  } else lines.push("  outbox  not tailed (--no-outbox)");
  if (info.sources.demo) lines.push("  demo    on");
  lines.push("");
  lines.push("  Ctrl-C to stop");
  return `${lines.join("\n")}\n`;
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref();
  } catch {}
}

/** `sessionpipe-gui theme list|add|link|remove`. Prints what it did; exits 1 on a problem. */
async function themeCommand(parsed: Args): Promise<void> {
  const { verb, arg } = parsed.theme!;
  const themesDir = parsed.themesDir ?? path.join(parsed.state ?? defaultStateDir(), "themes");
  const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
  try {
    switch (verb) {
      case "list":
      case "ls":
        out(formatList(themesDir, listThemes(themesDir)));
        return;
      case "add":
      case "install":
        if (!arg) fail("theme add needs a source: a folder, a .tgz/.zip, an npm package or a git URL");
        out((await addTheme(themesDir, arg)).message);
        return;
      case "link":
        if (!arg) fail("theme link needs a folder");
        out(linkTheme(themesDir, arg).message);
        return;
      case "remove":
      case "rm":
        if (!arg) fail("theme remove needs a theme id (see `theme list`)");
        out(removeTheme(themesDir, arg).message);
        return;
      default:
        fail(`unknown theme command "${verb}" (list, add, link, remove)`);
    }
  } catch (e) {
    if (e instanceof ThemeInstallError) {
      process.stderr.write(`sessionpipe-gui: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (parsed === "version") {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  if (parsed.theme) return themeCommand(parsed);
  const t0 = Date.now();
  let app: App;
  try {
    app = await createApp({
      port: parsed.port,
      host: parsed.host,
      stateDir: parsed.state,
      outbox: parsed.outbox,
      outboxPath: parsed.outboxPath,
      demo: parsed.demo,
      replay: parsed.replay,
      speed: parsed.speed,
      rpId: parsed.rpId,
      testDoor: parsed.testDoor,
      quiet: parsed.quiet,
      themesDir: parsed.themesDir,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") fail(`port ${parsed.port ?? DEFAULT_PORT} is in use (try --port)`);
    fail(err.message);
  }
  if (!parsed.quiet) {
    process.stdout.write(await banner(app));
    const s = app.store.stats();
    process.stdout.write(`  ready in ${Date.now() - t0} ms · ${s.sessions} sessions · ${s.events} events\n\n`);
  }
  if (parsed.open) openBrowser(app.info().urls.local);

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    if (!parsed.quiet) process.stdout.write(`\n${signal}: stopping\n`);
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref();
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main();
