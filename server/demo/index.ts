// SPDX-License-Identifier: Apache-2.0
// Owned by: demo. STUB — replace wholesale, keeping this contract. Synthetic sessions
// and a replay of any sessionpipe JSONL file, both fed through store.ingest.
import type { Store } from "../store/store.js";

export interface DemoOptions {
  /** Number of pretend machines. */
  machines?: number;
  /** 1 = real time; 5 = five times faster. */
  speed?: number;
  seed?: number;
}

export interface Runner {
  stop(): void;
}

export function startDemo(_store: Store, _opts: DemoOptions = {}): Runner {
  return { stop() {} };
}

export interface ReplayOptions {
  /** 0 = all at once; 1 = original timing; 10 = ten times faster. */
  speed?: number;
  /** Rewrite event times so the replay looks like it is happening now. */
  rebase?: boolean;
}

export function startReplay(_store: Store, _file: string, _opts: ReplayOptions = {}): Runner {
  return { stop() {} };
}
