// SPDX-License-Identifier: Apache-2.0
// The in-page state: a snapshot from the stream, then deltas applied to immutable maps so
// useSyncExternalStore sees one new object per change. Sessions and machines are keyed;
// recent events are a ring (newest first) the Feed page reads; control activity is kept
// for the control engineer's strip.
import type {
  ControlActivity,
  MachineSummary,
  SessionKey,
  SessionSummary,
  Stats,
  StoredEvent,
  StreamMessage,
  Viewer,
} from "@shared/api";
import type { Transport } from "./transport";

export type Connection = "connecting" | "live" | "reconnecting" | "offline";

export interface AppState {
  connection: Connection;
  /** When the next reconnect attempt is due (ms epoch), while reconnecting. */
  retryAt: number | null;
  snapshotAt: string | null;
  sessions: ReadonlyMap<SessionKey, SessionSummary>;
  machines: ReadonlyMap<string, MachineSummary>;
  stats: Stats | null;
  /** Newest first, capped at RING. */
  recent: readonly StoredEvent[];
  /** Newest first, capped at 200. */
  control: readonly ControlActivity[];
  /** Browsers on the stream right now, this one marked `current`. */
  viewers: readonly Viewer[];
  /** Counts every message, so a page can tell "something changed" cheaply. */
  version: number;
}

export const RING = 1500;

const initial: AppState = {
  connection: "connecting",
  retryAt: null,
  snapshotAt: null,
  sessions: new Map(),
  machines: new Map(),
  stats: null,
  recent: [],
  control: [],
  viewers: [],
  version: 0,
};

export type EventListener = (e: StoredEvent, session: SessionSummary) => void;

export class Store {
  private state: AppState = initial;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<EventListener>();
  private stop: (() => void) | null = null;
  private seen = new Set<string>();

  constructor(public readonly transport: Transport) {}

  get = (): AppState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  /** Live events as they arrive, for pages that append to their own lists. */
  onEvent = (l: EventListener): (() => void) => {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  };

  start() {
    if (this.stop) return;
    this.stop = this.transport.openStream({
      onMessage: (m) => this.apply(m),
      onOpen: () => this.set({ connection: this.state.snapshotAt ? "live" : "connecting", retryAt: null }),
      onError: (retryIn) => {
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        this.set({ connection: offline ? "offline" : "reconnecting", retryAt: Date.now() + retryIn });
      },
    });
  }

  close() {
    this.stop?.();
    this.stop = null;
  }

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    for (const l of this.listeners) l();
  }

  apply(m: StreamMessage) {
    switch (m.kind) {
      case "snapshot": {
        const s = m.snapshot;
        this.seen.clear();
        this.set({
          connection: "live",
          retryAt: null,
          snapshotAt: s.at,
          sessions: new Map(s.sessions.map((x) => [x.key, x])),
          machines: new Map(s.machines.map((x) => [x.name, x])),
          stats: s.stats,
          viewers: s.viewers ?? [],
        });
        return;
      }
      case "event": {
        const e = m.event;
        const dedup = `${e.harness.name}:${e.session.id}:${e.session.seq}`;
        if (this.seen.has(dedup)) return;
        this.seen.add(dedup);
        if (this.seen.size > RING * 2) {
          // Forget the oldest half; a replay that old is already out of the ring.
          const keep = [...this.seen].slice(-RING);
          this.seen = new Set(keep);
        }
        const sessions = new Map(this.state.sessions);
        sessions.set(m.session.key, m.session);
        const recent = [e, ...this.state.recent];
        if (recent.length > RING) recent.length = RING;
        this.set({ sessions, recent });
        for (const l of this.eventListeners) l(e, m.session);
        return;
      }
      case "session": {
        const sessions = new Map(this.state.sessions);
        sessions.set(m.session.key, m.session);
        this.set({ sessions });
        return;
      }
      case "forgotten": {
        const sessions = new Map(this.state.sessions);
        sessions.delete(m.key);
        const recent = this.state.recent.filter((e) => `${e.harness.name}:${e.session.id}` !== m.key);
        this.set({ sessions, recent });
        return;
      }
      case "machine": {
        const machines = new Map(this.state.machines);
        machines.set(m.machine.name, m.machine);
        this.set({ machines });
        return;
      }
      case "stats":
        this.set({ stats: m.stats });
        return;
      case "control": {
        const control = [m.message, ...this.state.control.filter((c) => c.id !== m.message.id)].slice(0, 200);
        this.set({ control });
        return;
      }
      case "viewers":
        this.set({ viewers: m.viewers });
        return;
      default:
        return;
    }
  }
}
