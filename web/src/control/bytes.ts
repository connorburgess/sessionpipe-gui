// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. Bytes in and out of base64url, utf-8 and sha256, on WebCrypto
// only. Every signature the browser makes or carries (CONTROL.md §2, §3) goes through
// these; nothing here is imported from sessionpipe-core, which the web bundle never pulls.

export type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s: string): Bytes => enc.encode(s) as Bytes;
export const fromUtf8 = (b: Uint8Array): string => dec.decode(b);

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i] as number);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url, strictly (no padding, no other alphabet); null for anything else. */
export function fromB64url(s: unknown): Bytes | null {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length) as Bytes;
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256(data: string | Uint8Array): Promise<Bytes> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Bytes)) as Bytes;
}

export const randomBytes = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(n)) as Bytes;

/** A nonce of 22+ base64url characters from 16 random bytes (CONTROL.md §3.1). */
export const nonce = (): string => b64url(randomBytes(16));

/** UUID v4, the session id rule for claude-code (ADAPTERS.md); codex and gemini keep
 *  the id a start names, so one shape serves every harness. */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
