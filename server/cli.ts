// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. `npx sessionpipe-gui`: start the receiver, print where to
// open it (with a QR code for a phone) and the one line that connects another
// machine. Ctrl-C stops it cleanly.
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import QRCode from "qrcode";
import { DEFAULT_PORT, ROUTES, UI_KEY_PARAM } from "../shared/api.js";
import { type App, createApp } from "./app.js";
import { defaultStateDir, packageVersion, readGuiConfig, setTlsPreference } from "./config.js";
import { lanAddresses } from "./http/net.js";
import { addTheme, formatList, linkTheme, listThemes, removeTheme, ThemeInstallError } from "./themes/index.js";
import { ensureCerts, localHostname, readCerts, resetCerts, TlsError } from "./tls/certs.js";

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
  --tls             TLS mode: the same port also answers https with a certificate from
                    the GUI's own local CA, so passkeys work from a phone (needs openssl);
                    remembered in config.json until --no-tls
  --no-tls          turn TLS mode off again (remembered)
  --rp-id HOST      WebAuthn rp id control passkeys are made for (default localhost;
                    with --tls, this machine's <name>.local)
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

color themes (token sets, picked in the page's quick settings): drop JSON files into
<state>/color-themes/*.json; see docs/color-theme.example.json.

tls (passkeys from a phone; README "Passkeys from a phone"):

  sessionpipe-gui tls status                 hostname, names in the certificate, expiry,
                                             the CA fingerprint and the file paths
  sessionpipe-gui tls trust                  macOS: add the CA to your login keychain
                                             (security add-trusted-cert; asks for your password)
  sessionpipe-gui tls reset                  delete the CA and the certificate; the next
                                             --tls start makes new ones (phones trust again)
  With --tls the rp id is <name>.local and passkeys work only on https://<name>.local:PORT,
  on the phone and on this machine; http://localhost still serves everything else. The
  name is mDNS: macOS advertises it itself, Linux needs avahi-daemon, Windows 10+ resolves it.
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
  /** `--tls` true, `--no-tls` false, neither: whatever config.json remembers. */
  tls?: boolean;
  /** `tls <verb>`: a subcommand instead of the server. */
  tlsCommand?: string;
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
      case "--tls":
        a.tls = true;
        break;
      case "--no-tls":
        a.tls = false;
        break;
      case "tls":
        if (a.tlsCommand !== undefined) fail("one tls command at a time");
        a.tlsCommand = argv[++i] ?? "";
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
  if (info.tls) {
    lines.push(
      `  https   ${info.tls.httpsUrl}/?${UI_KEY_PARAM}=${info.uiKey}   (passkeys; rp id ${info.control.rpId})`,
    );
    lines.push(`  trust   ${info.urls.lan[0] ?? info.urls.local}${ROUTES.trust}   CA ${info.tls.caFingerprint}`);
  }
  // With TLS on the QR opens the trust page (plain http), which installs the CA and then
  // forwards to the https origin: a fresh phone never meets a certificate warning first.
  const phoneUrl = info.urls.lan[0]
    ? `${info.urls.lan[0]}${info.tls ? ROUTES.trust : "/"}?${UI_KEY_PARAM}=${info.uiKey}`
    : null;
  if (phoneUrl) {
    lines.push("");
    lines.push(
      info.tls
        ? "  on a phone, scan this (same Wi-Fi; it starts with the trust steps):"
        : "  on a phone, scan this (same Wi-Fi):",
    );
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
  if (!info.tls) lines.push("  tls     off (passkeys from a phone need it: --tls)");
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

/** `sessionpipe-gui tls status|trust|reset`. */
function tlsCommand(parsed: Args): void {
  const verb = parsed.tlsCommand!;
  const stateDir = parsed.state ?? defaultStateDir();
  const dir = path.join(stateDir, "tls");
  const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
  const hostname = localHostname();
  switch (verb) {
    case "status": {
      const m = readCerts(dir);
      const cfg = readGuiConfig(stateDir);
      out(`tls mode   ${cfg.tls ? "on (remembered; --no-tls turns it off)" : "off (start with --tls)"}`);
      out(`hostname   ${hostname}`);
      if (!m) {
        out(`certs      none yet under ${dir} (made on the first --tls start)`);
        return;
      }
      out(`names      ${m.sans.join(", ")}`);
      if (!m.sans.includes(`DNS:${hostname}`)) {
        out(`           (the certificate was made for ${m.hostname}; it is re-issued at the next start)`);
      }
      out(`expires    server ${m.serverExpiresAt.slice(0, 10)} · CA ${m.caExpiresAt.slice(0, 10)}`);
      out(`CA sha256  ${m.caFingerprint}`);
      out(`files      ${m.caCertPath}`);
      out(`           ${m.caKeyPath}`);
      out(`           ${m.serverCertPath}`);
      out(`           ${m.serverKeyPath}`);
      return;
    }
    case "trust": {
      let m = readCerts(dir);
      if (!m) {
        try {
          m = ensureCerts(dir, { addresses: lanAddresses() });
        } catch (e) {
          if (e instanceof TlsError) fail(e.message);
          throw e;
        }
      }
      if (process.platform !== "darwin") {
        out(`On this platform add the CA by hand: ${m.caCertPath}`);
        out(
          "  Debian/Ubuntu: sudo cp ca.crt /usr/local/share/ca-certificates/sessionpipe-gui.crt && sudo update-ca-certificates",
        );
        out("  Fedora/RHEL:   sudo trust anchor ca.crt");
        out("  Firefox and Chrome keep their own store: Settings → Certificates → Authorities → Import.");
        return;
      }
      const keychain = path.join(process.env.HOME ?? "~", "Library", "Keychains", "login.keychain-db");
      out(`Adding "sessionpipe-gui local CA · ${m.hostname}" to ${keychain} (macOS asks for your password)…`);
      try {
        // The user trust domain (no -d): -d is the admin domain, which needs sudo and
        // otherwise imports the certificate without any trust setting.
        execFileSync(
          "security",
          ["add-trusted-cert", "-r", "trustRoot", "-p", "ssl", "-p", "basic", "-k", keychain, m.caCertPath],
          { stdio: "inherit" },
        );
        const dump = execFileSync("security", ["dump-trust-settings"], { encoding: "utf8" });
        if (!dump.includes("sessionpipe-gui local CA"))
          fail(
            `The certificate was imported but has no trust setting. By hand: open ${m.caCertPath} in Keychain Access and set "Always Trust" for SSL.`,
          );
      } catch {
        fail(
          `security add-trusted-cert did not finish. By hand: open ${m.caCertPath} in Keychain Access and set "Always Trust" for SSL.`,
        );
      }
      out(`Trusted. Open https://${m.hostname}:${parsed.port ?? DEFAULT_PORT}/ in this Mac's browser.`);
      return;
    }
    case "reset": {
      out(
        resetCerts(dir)
          ? `Deleted ${dir}; the next --tls start makes a new CA (phones must trust it again).`
          : `Nothing under ${dir}.`,
      );
      return;
    }
    default:
      fail(`unknown tls command "${verb}" (status, trust, reset)`);
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
  if (parsed.tlsCommand !== undefined) return tlsCommand(parsed);
  const t0 = Date.now();
  // --tls / --no-tls are remembered in config.json; a bare start uses the remembered choice.
  const stateDir = parsed.state ?? defaultStateDir();
  const tls =
    parsed.tls === undefined
      ? readGuiConfig(stateDir).tls === true
      : setTlsPreference(stateDir, readGuiConfig(stateDir), parsed.tls).tls === true;
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
      tls,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") fail(`port ${parsed.port ?? DEFAULT_PORT} is in use (try --port)`);
    if (err instanceof TlsError) fail(`${err.message}\n(--no-tls starts without TLS mode)`);
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
