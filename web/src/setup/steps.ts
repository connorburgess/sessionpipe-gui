// SPDX-License-Identifier: Apache-2.0
// Owned by: onboarding. What makes each of the five steps green, from the server's facts
// and this page's own (its origin, whether passkeys can work here). Shared by the page,
// the rail's dot and the first-run redirect so they never disagree.
import type { SetupStatus } from "@shared/api";
import { passkeysAvailable } from "../control/webauthn";

export type StepKey = "sessions" | "secure" | "pair" | "phone" | "try";
export const STEP_ORDER: StepKey[] = ["sessions", "secure", "pair", "phone", "try"];

/** Whether this page is on the https origin TLS mode serves. */
export function onHttpsOrigin(s: SetupStatus): boolean {
  if (typeof location === "undefined") return false;
  try {
    return location.origin === new URL(s.tls.httpsUrl).origin;
  } catch {
    return false;
  }
}

/** Step 2: TLS on, the system trusts the CA (or cannot say), and passkeys work right here. */
export function secureHere(s: SetupStatus): boolean {
  return s.tls.on && s.tls.caTrusted !== false && passkeysAvailable(s.tls.rpId);
}

export function stepsDone(s: SetupStatus, tried: boolean): Record<StepKey, boolean> {
  return {
    sessions: s.events.total > 0,
    secure: secureHere(s),
    pair: s.daemon.pairedHere && s.daemon.online,
    phone: s.tls.on && s.viewers.phones > 0,
    try: s.tried.delivered > 0 || tried,
  };
}

/** The three facts a brand-new machine lacks: what sends `/` to `/setup` once. */
export function needsSetup(s: SetupStatus): boolean {
  return s.events.total === 0 || !s.tls.on || !s.daemon.pairedHere;
}

/** What the rail's "Setup" entry waits for: the durable facts (a phone on the stream
 *  comes and goes, so it is not one of them). */
export function setupComplete(s: SetupStatus): boolean {
  return s.events.total > 0 && s.tls.on && s.tls.caTrusted !== false && s.daemon.pairedHere && s.tried.delivered > 0;
}

/** Does a session's machine name mean this machine? */
export function sameMachineName(name: string | undefined, s: SetupStatus): boolean {
  if (!name) return false;
  const norm = (x: string) =>
    x
      .trim()
      .toLowerCase()
      .replace(/\.local\.?$/, "");
  const mine = [s.daemon.name, s.tls.hostname].filter((x): x is string => !!x).map(norm);
  return mine.includes(norm(name));
}
