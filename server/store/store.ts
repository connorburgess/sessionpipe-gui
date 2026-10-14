// SPDX-License-Identifier: Apache-2.0
// Owned by: server-core. STUB — the real store replaces this file. See ARCHITECTURE.md
// "Store" for the contract every other module relies on.
import type {
  EventSource,
  ProtocolEvent,
  SessionKey,
  SessionSummary,
  Snapshot,
  StoredEvent,
} from "../../shared/api.js";

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: { id: string; reason: string }[];
  /** The stored events, in input order, for those accepted. */
  stored: StoredEvent[];
}

export type StoreListener = (msg: import("../../shared/api.js").StreamMessage) => void;

export class Store {
  constructor(readonly dir: string) {}
  ingest(_events: ProtocolEvent[], _source: EventSource): IngestResult {
    return { accepted: 0, duplicates: 0, rejected: [], stored: [] };
  }
  snapshot(): Snapshot {
    return {
      at: new Date().toISOString(),
      sessions: [],
      machines: [],
      stats: { events: 0, sessions: 0, machines: 0, eventsLastMinute: 0, storageBytes: 0, uptimeS: 0 },
    };
  }
  session(_key: SessionKey): SessionSummary | undefined {
    return undefined;
  }
  subscribe(_l: StoreListener): () => void {
    return () => {};
  }
  async close(): Promise<void> {}
}
