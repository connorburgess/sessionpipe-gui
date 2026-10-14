// SPDX-License-Identifier: Apache-2.0
// Append-only JSONL per session under <stateDir>/events/<harness>/<session>.jsonl, one
// StoredEvent per line. The index (store.ts) remembers each line's byte offset and
// length so the full event can be read back from disk on demand.
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { StoredEvent } from "../../shared/api.js";

/** A file-name-safe id (the same rule as sessionpipe-core's safeId). */
export const safeName = (s: string): string =>
  String(s)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 160);

export interface Line {
  event: StoredEvent;
  /** Byte offset of the line in its file. */
  offset: number;
  /** Byte length of the line, newline excluded. */
  bytes: number;
}

export interface ScannedFile {
  harness: string;
  id: string;
  file: string;
  size: number;
  lines: Line[];
}

export class EventFiles {
  readonly root: string;
  constructor(stateDir: string) {
    this.root = path.join(stateDir, "events");
  }

  file(harness: string, id: string): string {
    return path.join(this.root, safeName(harness), `${safeName(id)}.jsonl`);
  }

  /** Every session file with its lines, in directory order. A line that is not JSON
   *  is skipped; its bytes still count toward the offsets after it. */
  scan(): ScannedFile[] {
    const out: ScannedFile[] = [];
    if (!existsSync(this.root)) return out;
    for (const h of readdirSync(this.root)) {
      const dir = path.join(this.root, h);
      let names: string[];
      try {
        names = readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const n of names) {
        const file = path.join(dir, n);
        let buf: Buffer;
        try {
          buf = readFileSync(file);
        } catch {
          continue;
        }
        const lines: Line[] = [];
        let harness = h;
        let id = n.slice(0, -6);
        let pos = 0;
        while (pos < buf.length) {
          let nl = buf.indexOf(10, pos);
          if (nl < 0) nl = buf.length;
          const bytes = nl - pos;
          if (bytes > 0) {
            try {
              const event = JSON.parse(buf.toString("utf8", pos, nl)) as StoredEvent;
              if (event && typeof event === "object" && event.session && typeof event.session.id === "string") {
                harness = event.harness.name;
                id = event.session.id;
                lines.push({ event, offset: pos, bytes });
              }
            } catch {}
          }
          pos = nl + 1;
        }
        out.push({ harness, id, file, size: buf.length, lines });
      }
    }
    return out;
  }

  /** Append events to a session's file; returns each line's offset and length. */
  append(harness: string, id: string, events: StoredEvent[], size: number): { lines: Line[]; size: number } {
    const file = this.file(harness, id);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const lines: Line[] = [];
    const parts: Buffer[] = [];
    let pos = size;
    for (const event of events) {
      const b = Buffer.from(`${JSON.stringify(event)}\n`);
      lines.push({ event, offset: pos, bytes: b.length - 1 });
      parts.push(b);
      pos += b.length;
    }
    appendFileSync(file, Buffer.concat(parts), { mode: 0o600 });
    return { lines, size: pos };
  }

  /** Read full events back by offset. A line that cannot be read yields undefined. */
  readAt(harness: string, id: string, at: { offset: number; bytes: number }[]): (StoredEvent | undefined)[] {
    const file = this.file(harness, id);
    let fd: number;
    try {
      fd = openSync(file, "r");
    } catch {
      return at.map(() => undefined);
    }
    try {
      return at.map(({ offset, bytes }) => {
        const buf = Buffer.alloc(bytes);
        const n = readSync(fd, buf, 0, bytes, offset);
        try {
          return JSON.parse(buf.toString("utf8", 0, n)) as StoredEvent;
        } catch {
          return undefined;
        }
      });
    } finally {
      closeSync(fd);
    }
  }

  remove(harness: string, id: string): void {
    rmSync(this.file(harness, id), { force: true });
  }

  sizeOf(harness: string, id: string): number {
    try {
      return statSync(this.file(harness, id)).size;
    } catch {
      return 0;
    }
  }
}
