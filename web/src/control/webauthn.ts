// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. The two WebAuthn ceremonies the control channel needs
// (CONTROL.md §2, §3.2): making a passkey for the receiver's rp id, and asserting over a
// 32-byte challenge with it. The passkeys this browser made are remembered per rp id
// (credential id, alg, SPKI) in localStorage, so a later approval or grant can name them.
import { type Assertion, controlApi, type TrustedKey } from "./api";
import { b64url, fromB64url, randomBytes } from "./bytes";

export const ES256 = -7;
export const RS256 = -257;

/** Why no control affordance can work here: passkeys need a secure context. */
export const INSECURE_HINT = "passkeys need https or localhost: open this page on the machine running sessionpipe-gui";

/** Can this page use passkeys at all? False over plain LAN http (a phone on the Wi-Fi). */
export function passkeysAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof PublicKeyCredential !== "undefined" &&
    !!navigator.credentials?.create
  );
}

export interface StoredPasskey extends TrustedKey {
  name?: string;
  createdAt: string;
}

const storeKey = (rp: string) => `sessionpipe.passkeys:${rp}`;

export function storedPasskeys(rp: string): StoredPasskey[] {
  try {
    const raw = localStorage.getItem(storeKey(rp));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter(
          (k): k is StoredPasskey =>
            !!k && typeof k === "object" && typeof (k as StoredPasskey).id === "string" && "spki" in (k as object),
        )
      : [];
  } catch {
    return [];
  }
}

export function rememberPasskey(rp: string, key: StoredPasskey): void {
  try {
    const list = storedPasskeys(rp).filter((k) => k.id !== key.id);
    list.unshift(key);
    localStorage.setItem(storeKey(rp), JSON.stringify(list.slice(0, 10)));
  } catch {
    // private mode or storage full: the key still works for this page load
  }
}

export function forgetPasskey(rp: string, id: string): void {
  try {
    localStorage.setItem(storeKey(rp), JSON.stringify(storedPasskeys(rp).filter((k) => k.id !== id)));
  } catch {
    // ignore
  }
}

/** A short name for the device, offered as the key's name ("iPhone", "Mac"). */
export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux box";
  return "this browser";
}

/** What the person did, in words, when a ceremony ends without a credential. */
export function webauthnError(e: unknown): string {
  const err = e as { name?: string; message?: string } | null;
  switch (err?.name) {
    case "NotAllowedError":
      return "The passkey prompt was dismissed or timed out.";
    case "InvalidStateError":
      return "This passkey is already registered here.";
    case "NotSupportedError":
      return "This browser cannot make a passkey of a kind the machine accepts.";
    case "SecurityError":
      return INSECURE_HINT;
    case "AbortError":
      return "The passkey prompt was cancelled.";
    default:
      return err?.message ?? String(e);
  }
}

/** Make a passkey for `rp` (CONTROL.md §2: ES256 first, RS256 second; a resident key when
 *  the authenticator offers one; the person verified). The challenge is the receiver's
 *  (GET /challenge), since creation has no deterministic one of its own. */
export async function registerPasskey(rp: string, name: string): Promise<StoredPasskey> {
  const c = await controlApi.challenge();
  const challenge = fromB64url(c.challenge);
  if (!challenge) throw new Error("The receiver sent an unreadable challenge.");
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { id: rp, name: "sessionpipe-gui" },
      user: { id: randomBytes(16), name: `sessionpipe · ${name}`, displayName: name },
      pubKeyCredParams: [
        { type: "public-key", alg: ES256 },
        { type: "public-key", alg: RS256 },
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      attestation: "none",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was made.");
  const resp = cred.response as AuthenticatorAttestationResponse;
  const alg = resp.getPublicKeyAlgorithm?.();
  const spki = resp.getPublicKey?.();
  if (!spki || (alg !== ES256 && alg !== RS256))
    throw new Error("This browser cannot hand over the passkey's public key in a shape the machine can use.");
  const key: StoredPasskey = {
    id: b64url(cred.rawId),
    alg,
    spki: b64url(spki),
    name,
    createdAt: new Date().toISOString(),
  };
  rememberPasskey(rp, key);
  return key;
}

/** One assertion over `challenge` (32 bytes) with a passkey for `rp`. `allow` narrows the
 *  prompt to those credential ids; empty lets the browser offer every resident key. */
export async function assertPasskey(rp: string, challenge: Uint8Array, allow: string[] = []): Promise<Assertion> {
  const allowCredentials: PublicKeyCredentialDescriptor[] = [];
  for (const id of allow) {
    const raw = fromB64url(id);
    if (raw) allowCredentials.push({ type: "public-key", id: raw });
  }
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as Uint8Array<ArrayBuffer>,
      rpId: rp,
      userVerification: "required",
      timeout: 120_000,
      ...(allowCredentials.length ? { allowCredentials } : {}),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey answered.");
  const resp = cred.response as AuthenticatorAssertionResponse;
  return {
    cred: b64url(cred.rawId),
    ad: b64url(resp.authenticatorData),
    cd: b64url(resp.clientDataJSON),
    sig: b64url(resp.signature),
  };
}
