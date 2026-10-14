// SPDX-License-Identifier: Apache-2.0
// Test helpers: protocol events with the fields a test does not care about filled in.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ulid } from "sessionpipe-core";
import type { ProtocolEvent, Tier } from "../shared/api.js";

export interface EventSpec {
  type: string;
  seq?: number;
  id?: string;
  time?: string;
  tier?: Tier;
  harness?: string;
  version?: string;
  session?: Partial<ProtocolEvent["session"]> & { id?: string };
  data?: Record<string, unknown>;
}

export const SID = "8c132906-8c3f-4814-870a-afc3d05e1d2e";

/** A sequence of events of one session; `seq` counts up unless given. */
export class Session {
  seq = 0;
  constructor(
    readonly id = SID,
    readonly harness = "claude-code",
    /** Event times start a minute ago, so they always precede arrival (clamped otherwise). */
    public clock = Date.now() - 60_000,
  ) {}

  ev(type: string, data: Record<string, unknown> = {}, extra: Partial<EventSpec> = {}): ProtocolEvent {
    const seq = extra.seq ?? this.seq++;
    if (extra.seq !== undefined && extra.seq >= this.seq) this.seq = extra.seq + 1;
    const tier = extra.tier ?? 3;
    this.clock += 1000;
    return {
      protocol: 1,
      id: extra.id ?? ulid(this.clock),
      type,
      time: extra.time ?? new Date(this.clock).toISOString(),
      tier,
      harness: { name: extra.harness ?? this.harness, version: extra.version ?? "2.1.296", event: "Hook" },
      session: { id: this.id, seq, machine: "misha-air", cwd: "~/proj", ...(extra.session ?? {}) },
      privacy: { rulesets: tier > 0 ? ["secrets@1"] : [], pii: false },
      data,
    };
  }
}

export function event(spec: EventSpec): ProtocolEvent {
  const s = new Session(spec.session?.id ?? SID, spec.harness ?? "claude-code");
  return s.ev(spec.type, spec.data ?? {}, spec);
}

export function tempDir(prefix = "spgui-"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
