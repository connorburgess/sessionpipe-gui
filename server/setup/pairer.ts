// SPDX-License-Identifier: Apache-2.0
// Owned by: onboarding. The one `sessionpipe control pair` child the setup page may start:
// it asks this receiver for a code, prints the link and the six digits, and polls until
// someone approves (or the link runs out). We keep the reference so a second click does
// not start a second one, read its stdout for the code and the digits as a fallback to
// what control itself reports, and kill it on cancel or shutdown.
import { type ChildProcess, spawn } from "node:child_process";

export interface PairerState {
  active: boolean;
  startedAt?: string;
  code?: string;
  check?: string;
  url?: string;
  /** The child printed "✓ Paired". */
  paired?: boolean;
  exitCode?: number | null;
  /** The last thing that went wrong, in the child's words. */
  error?: string;
}

export type SpawnFn = (
  file: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; stdio: ["ignore", "pipe", "pipe"]; shell?: boolean },
) => ChildProcess;

export class Pairer {
  private child: ChildProcess | null = null;
  private st: PairerState = { active: false };

  constructor(private readonly spawnFn: SpawnFn = spawn as unknown as SpawnFn) {}

  state(): PairerState {
    return { ...this.st };
  }

  /** Start the child; false when one is already running. */
  start(file: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; shell?: boolean }): boolean {
    if (this.child) return false;
    this.st = { active: true, startedAt: new Date().toISOString() };
    let child: ChildProcess;
    try {
      child = this.spawnFn(file, args, {
        cwd: o.cwd,
        env: o.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...(o.shell ? { shell: true } : {}),
      });
    } catch (e) {
      this.st = { active: false, exitCode: null, error: (e as Error).message };
      return true;
    }
    this.child = child;
    let out = "";
    let err = "";
    const onLine = (line: string) => {
      const code = /\/pair\?code=([A-Za-z0-9_-]+)/.exec(line);
      if (code?.[1]) this.st.code = code[1];
      const url = /(https?:\/\/\S+\/pair\?code=\S+)/.exec(line);
      if (url?.[1]) this.st.url = url[1];
      const digits = /digits too: (\d{6})\b/.exec(line) ?? /enter:\s+(\d{3}) ?(\d{3})\b/.exec(line);
      if (digits) this.st.check = `${digits[1]}${digits[2] ?? ""}`;
      if (/✓ Paired/.test(line)) this.st.paired = true;
      if (/^\s*!/.test(line) || /^error:/i.test(line)) this.st.error = line.trim();
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => {
      out += d;
      for (let i = out.indexOf("\n"); i >= 0; i = out.indexOf("\n")) {
        onLine(out.slice(0, i));
        out = out.slice(i + 1);
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d: string) => {
      err += d;
      if (err.length > 8000) err = err.slice(-8000);
    });
    child.on("error", (e) => {
      this.st.error = e.message;
    });
    child.on("exit", (code) => {
      if (out.trim()) onLine(out);
      this.child = null;
      this.st.active = false;
      this.st.exitCode = code;
      if (code !== 0 && !this.st.paired) {
        const last = (err.trim() || out.trim()).split("\n").filter(Boolean).pop();
        if (last) this.st.error = this.st.error ?? last.trim();
        else this.st.error ??= code === null ? "the pairing command was stopped" : `the pairing command exited ${code}`;
      }
    });
    return true;
  }

  /** Stop the child; false when none was running. */
  cancel(): boolean {
    const c = this.child;
    if (!c) return false;
    try {
      c.kill("SIGTERM");
    } catch {}
    this.child = null;
    this.st = { ...this.st, active: false, exitCode: null, error: undefined };
    return true;
  }

  close(): void {
    this.cancel();
  }
}
