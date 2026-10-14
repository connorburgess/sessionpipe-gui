// SPDX-License-Identifier: Apache-2.0
// Owned by: demo. Replays a JSONL file of protocol events (a sessionpipe file sink, an
// outbox, or this GUI's own event files) through the store, paced by the original gaps.
import { readFileSync } from "node:fs";
import type { ProtocolEvent } from "../../shared/api.js";

export interface ReplayPlan {
  /** Ordered by time, times possibly rebased. */
  events: ProtocolEvent[];
  /** Virtual ms of each event from the first one (gaps capped when asked). */
  offsets: number[];
  /** Lines that were not events (not JSON, or not a valid envelope). */
  skipped: number;
}

export interface PlanOptions {
  /** Shift the times so the first event is `now` and the rest follow at their offsets. */
  rebase?: boolean;
  /** Cap any gap between two consecutive events, so a month of history does not take a month. */
  maxGapMs?: number;
  /** What "now" is for rebasing (tests). */
  now?: number;
}

const TIME_FIELDS = ["at", "started_at", "last_at"];

/** The envelope a replay needs: protocol 1, a type, a parseable time, a session with
 *  id and seq, a harness name, a data object. Per-type data is the store's business
 *  (real history may carry more than the schema's caps). */
export function looksLikeEvent(o: Record<string, unknown>): boolean {
  const s = o.session as Record<string, unknown> | undefined;
  const h = o.harness as Record<string, unknown> | undefined;
  return (
    o.protocol === 1 &&
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    typeof o.time === "string" &&
    !Number.isNaN(Date.parse(o.time)) &&
    typeof h === "object" &&
    h !== null &&
    typeof h.name === "string" &&
    typeof s === "object" &&
    s !== null &&
    typeof s.id === "string" &&
    typeof s.seq === "number" &&
    typeof o.data === "object" &&
    o.data !== null
  );
}

/** Parses the file: one event per line, `arrivedAt` / `source` stripped when present
 *  (a StoredEvent), lines that do not parse or do not look like an event skipped,
 *  sorted by time. */
export function loadEvents(file: string): { events: ProtocolEvent[]; skipped: number } {
  const text = readFileSync(file, "utf8");
  const events: ProtocolEvent[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (typeof obj !== "object" || obj === null) {
      skipped++;
      continue;
    }
    const { arrivedAt: _a, source: _s, ...rest } = obj as Record<string, unknown>;
    if (!looksLikeEvent(rest)) {
      skipped++;
      continue;
    }
    events.push(rest as unknown as ProtocolEvent);
  }
  // A stable sort keeps a file's own order for equal times.
  events.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return { events, skipped };
}

export function planReplay(file: string, opts: PlanOptions = {}): ReplayPlan {
  const { events, skipped } = loadEvents(file);
  const cap = opts.maxGapMs !== undefined && opts.maxGapMs >= 0 ? opts.maxGapMs : Number.POSITIVE_INFINITY;
  const offsets: number[] = [];
  let off = 0;
  let prev = events.length ? Date.parse(events[0]!.time) : 0;
  for (const e of events) {
    const t = Date.parse(e.time);
    off += Math.min(Math.max(0, t - prev), cap);
    prev = t;
    offsets.push(off);
  }
  if (opts.rebase ?? true) {
    const now = opts.now ?? Date.now();
    events.forEach((e, i) => {
      const was = Date.parse(e.time);
      const is = now + (offsets[i] as number);
      e.time = new Date(is).toISOString();
      const shift = is - was;
      for (const k of TIME_FIELDS) {
        const v = e.data[k];
        if (typeof v === "string") {
          const t = Date.parse(v);
          if (!Number.isNaN(t)) e.data[k] = new Date(t + shift).toISOString();
        }
      }
    });
  }
  return { events, offsets, skipped };
}

export const BATCH = 50;

/** Hands the events to `sink` in batches of at most 50, in order. */
export function inBatches(events: ProtocolEvent[], sink: (batch: ProtocolEvent[]) => void): void {
  for (let i = 0; i < events.length; i += BATCH) sink(events.slice(i, i + BATCH));
}
