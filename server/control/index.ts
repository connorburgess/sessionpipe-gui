// SPDX-License-Identifier: Apache-2.0
// Owned by: control. STUB — replace wholesale, keeping this exact contract (app.ts
// and the UI layer code against it). Everything of spec/CONTROL.md and HTTP.md §3 on
// the receiver side lives under server/control/.
import type { ControlActivity, MachineControl, StreamMessage } from "../../shared/api.js";
import type { Ctx, Router } from "../http/router.js";

export interface ControlDeps {
  stateDir: string;
  /** The current sink token: pairing with a sink token presents it (CONTROL.md §2 step 1). */
  sinkToken: () => string;
  /** WebAuthn rp id passkeys are made for; "localhost" by default. */
  rpId: string;
  /** Loopback-only test door for the conformance runner (`enqueue`, `approve`); off by default. */
  testDoor: boolean;
  /** Whether a request may use the UI API (loopback or UI-key cookie); supplied by server-core. */
  uiAuth: (ctx: Ctx) => boolean;
  /** Harness:session keys the store knows, for validating a command's session (optional help). */
  sessionExists?: (key: string) => boolean;
}

export interface Control {
  /** Machine routes (pair, hello, poll, ack, off) under ROUTES.control, and the UI's
   *  /api/ui/control/* routes. */
  register(router: Router): void;
  /** Paired machines, keyed by the daemon's `name` (the same name events carry in session.machine). */
  machines(): Map<string, MachineControl>;
  activity(limit?: number): ControlActivity[];
  subscribe(l: (m: StreamMessage) => void): () => void;
  /** The `control` member of the well-known file (HTTP.md §1). */
  wellKnown(): { wait_max_s: number; open_pairing?: boolean; signing: { rp_id: string; algs: number[] } };
  close(): void;
}

export function createControl(deps: ControlDeps): Control {
  const listeners = new Set<(m: StreamMessage) => void>();
  return {
    register() {},
    machines: () => new Map(),
    activity: () => [],
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    wellKnown: () => ({ wait_max_s: 25, open_pairing: true, signing: { rp_id: deps.rpId, algs: [-7, -257] } }),
    close() {},
  };
}
