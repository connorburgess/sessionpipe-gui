// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. The browser's side of /api/ui/control/* (server/control/README.md):
// pairings and their approval, a WebAuthn challenge, sending a signed command, the
// activity and the paired machines. Same-origin fetch, JSON both ways, errors by code.
import type { ControlActivity, Info, MachineControl, TlsInfo } from "@shared/api";
import { ROUTES } from "@shared/api";

const BASE = ROUTES.ui.control;

export interface Pairing {
  code: string;
  check: string;
  status: "pending" | "approved" | "expired" | "done";
  open: boolean;
  fromIp: string;
  startedAt: string;
  expiresAt: string;
  machine: {
    id: string;
    name: string;
    harnesses: string[];
    modes: string[];
    version: string;
    folders?: string[];
    mode?: "safe" | "auto";
    accounts?: { harness: string; id: string; email: string }[];
    firstPairing: boolean;
    keys: number;
  };
  rpId: string;
  /** base64url(sha256("sessionpipe.pair:" + machine + ":" + code)): the WebAuthn challenge. */
  challenge: string;
}

export interface TrustedKey {
  id: string;
  alg: -7 | -257;
  spki: string;
}

export interface Assertion {
  cred: string;
  ad: string;
  cd: string;
  sig: string;
}

export interface GrantBundle extends Assertion {
  str: string;
}

export interface SendBody {
  machineId: string;
  cmd: string;
  csig?: string;
  grant?: GrantBundle;
  confirm?: Assertion;
  expires_in_s?: number;
}

export type PairedMachine = MachineControl & { name: string; createdAt: string; pairedAt?: string };

/** A refusal from the server: `status` and the body's `reason`; `code` is the verifier's
 *  word on a refused command (`unsigned`, `untrusted_key`, `bad_csig`, `too_old`, …). */
export class ControlError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly code?: string,
    readonly detail?: string,
  ) {
    super(detail ?? reason);
    this.name = "ControlError";
  }
}

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // no body
  }
  if (!res.ok) {
    const reason = typeof json.reason === "string" ? json.reason : `http_${res.status}`;
    const code = typeof json.code === "string" ? json.code : undefined;
    const detail =
      typeof json.detail === "string" ? json.detail : typeof json.error === "string" ? json.error : undefined;
    throw new ControlError(res.status, reason, code, detail);
  }
  return json as T;
}

export const controlApi = {
  pairings: () => call<{ pairings: Pairing[] }>("GET", `${BASE}/pairings`).then((r) => r.pairings),
  pairing: (code: string) => call<Pairing>("GET", `${BASE}/pair/${encodeURIComponent(code)}`),
  approve: (code: string, body: { key: TrustedKey; proof: Assertion; name?: string; by?: string }) =>
    call<{ ok: true; machineId: string; keyId: string; firstPairing: boolean }>(
      "POST",
      `${BASE}/pair/${encodeURIComponent(code)}/approve`,
      body,
    ),
  reject: (code: string) => call<void>("POST", `${BASE}/pair/${encodeURIComponent(code)}/reject`),
  challenge: () =>
    call<{ challenge: string; rpId: string; origin: string; expiresAt: string }>("GET", `${BASE}/challenge`),
  send: (body: SendBody) => call<ControlActivity>("POST", `${BASE}/send`, body),
  activity: (limit = 100) =>
    call<{ activity: ControlActivity[] }>("GET", `${BASE}/activity?limit=${limit}`).then((r) => r.activity),
  machines: () => call<{ machines: PairedMachine[] }>("GET", `${BASE}/machines`).then((r) => r.machines),
};

let rpIdPromise: Promise<string> | null = null;
let tlsCache: TlsInfo | null | undefined;

/** The rp id this receiver makes passkeys for (Info.control.rpId), fetched once. The
 *  same read remembers Info.tls for `tlsInfo()`. */
export function rpId(): Promise<string> {
  if (!rpIdPromise) {
    rpIdPromise = fetch(ROUTES.ui.info, { headers: { accept: "application/json" } })
      .then((r) => r.json() as Promise<Info>)
      .then((i) => {
        tlsCache = i.tls ?? null;
        return i.control?.rpId ?? "localhost";
      })
      .catch((e) => {
        rpIdPromise = null;
        throw e;
      });
  }
  return rpIdPromise;
}

/** Info.tls as last read (by `rpId()`): null when the server has no TLS mode on,
 *  undefined before the first read lands. Synchronous, for hint text. */
export function tlsInfo(): TlsInfo | null | undefined {
  if (tlsCache === undefined) void rpId().catch(() => {});
  return tlsCache;
}
