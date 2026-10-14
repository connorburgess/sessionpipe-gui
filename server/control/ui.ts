// SPDX-License-Identifier: Apache-2.0
// What the board's browser calls under /api/ui/control/*: the pairings to approve, the
// approval itself (an enrollment proof the core verifier checks), sending a signed
// command (the verifier as the receiver's early word, §5), the activity and the
// machines. Every route needs the UI's own auth (loopback, or the UI key cookie).
// Documented route by route in README.md beside this file.
import { randomBytes } from "node:crypto";
import {
  b64url,
  keyUsable,
  pairChallenge,
  RECEIVER_MAX_AGE_MS,
  type SignedCommand,
  verifyCommand,
  verifyEnrollment,
} from "sessionpipe-core/control";
import type { Ctx, Handler, Reply, Router } from "../http/router.js";
import { HttpError } from "../http/router.js";
import { CODE_RE, MACHINE_RE } from "./parse.js";
import { requestOrigin } from "./routes.js";
import { type ControlState, type MachineRow, type PairingRow, toActivity } from "./state.js";

export interface UiRouteDeps {
  state: ControlState;
  rpId: string;
  uiAuth: (ctx: Ctx) => boolean;
  /** ROUTES.ui.control */
  base: string;
}

const CHALLENGE_TTL_MS = 5 * 60_000;

export async function pairingView(machine: MachineRow, pairing: PairingRow, rpId: string) {
  const status = pairing.deliveredAt
    ? "done"
    : pairing.approved
      ? "approved"
      : Date.parse(pairing.expiresAt) > Date.now()
        ? "pending"
        : "expired";
  return {
    code: pairing.code,
    check: pairing.check,
    status,
    open: pairing.open,
    fromIp: pairing.fromIp,
    startedAt: pairing.startedAt,
    expiresAt: pairing.expiresAt,
    machine: {
      id: machine.id,
      name: machine.name,
      harnesses: machine.harnesses,
      modes: machine.modes,
      version: machine.version,
      ...(machine.folders ? { folders: machine.folders } : {}),
      ...(machine.mode ? { mode: machine.mode } : {}),
      ...(machine.accounts ? { accounts: machine.accounts } : {}),
      firstPairing: !machine.tokenHash,
      keys: machine.keys.length,
    },
    rpId,
    /** What the passkey signs (CONTROL.md §2 step 2), base64url: pass it as the WebAuthn challenge. */
    challenge: b64url(await pairChallenge(machine.id, pairing.code)),
  };
}

export function registerUiRoutes(router: Router, d: UiRouteDeps): void {
  const { state, base, rpId } = d;
  const guarded =
    (h: Handler): Handler =>
    (ctx) => {
      if (!d.uiAuth(ctx)) throw new HttpError(401, { reason: "unauthorized" });
      return h(ctx);
    };
  const challenges = new Map<string, number>();

  router.get(
    `${base}/pairings`,
    guarded(
      async (): Promise<Reply> => ({
        status: 200,
        json: {
          pairings: await Promise.all(
            state.pendingPairings().map(({ machine, pairing }) => pairingView(machine, pairing, rpId)),
          ),
        },
      }),
    ),
  );

  router.get(
    `${base}/pair/:code`,
    guarded(async (ctx): Promise<Reply> => {
      const found = CODE_RE.test(ctx.params.code ?? "") ? state.findPairing(ctx.params.code!) : undefined;
      if (!found) throw new HttpError(404, { reason: "not_found" });
      return { status: 200, json: await pairingView(found.machine, found.pairing, rpId) };
    }),
  );

  // A random challenge for a WebAuthn ceremony that has no deterministic one (making a
  // passkey with navigator.credentials.create()). Remembered five minutes.
  router.get(
    `${base}/challenge`,
    guarded((ctx): Reply => {
      const now = Date.now();
      for (const [c, t] of challenges) if (t < now) challenges.delete(c);
      const challenge = randomBytes(32).toString("base64url");
      challenges.set(challenge, now + CHALLENGE_TTL_MS);
      return {
        status: 200,
        json: {
          challenge,
          rpId,
          origin: requestOrigin(ctx),
          expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
        },
      };
    }),
  );

  // CONTROL.md §2 step 2: the person confirmed the digits with a passkey. The proof is
  // the key's assertion over sha256("sessionpipe.pair:" + machine + ":" + code); only a
  // proof that verifies here goes to the daemon, which verifies it again.
  router.post(
    `${base}/pair/:code/approve`,
    guarded(async (ctx): Promise<Reply> => {
      const found = CODE_RE.test(ctx.params.code ?? "") ? state.findPairing(ctx.params.code!) : undefined;
      if (!found) throw new HttpError(404, { reason: "not_found" });
      const { machine, pairing } = found;
      if (pairing.approved || pairing.deliveredAt) throw new HttpError(409, { reason: "already_approved" });
      if (Date.parse(pairing.expiresAt) <= Date.now()) throw new HttpError(410, { reason: "expired" });
      const body = await ctx.json<{ key?: unknown; proof?: unknown; name?: unknown; by?: unknown }>(64 * 1024);
      const key = body.key as { id?: unknown; alg?: unknown; spki?: unknown } | undefined;
      const proof = body.proof as { cred?: unknown; ad?: unknown; cd?: unknown; sig?: unknown } | undefined;
      const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
      if (
        !key ||
        typeof key !== "object" ||
        !str(key.id, 1400) ||
        (key.alg !== -7 && key.alg !== -257) ||
        !str(key.spki, 4000) ||
        !proof ||
        typeof proof !== "object" ||
        !str(proof.cred, 1400) ||
        !str(proof.ad, 8000) ||
        !str(proof.cd, 8000) ||
        !str(proof.sig, 4000)
      )
        throw new HttpError(400, {
          reason: "bad_request",
          error: "Send { key: {id, alg, spki}, proof: {cred, ad, cd, sig} }.",
        });
      const k = { id: key.id as string, alg: key.alg as number, spki: key.spki as string };
      const p = {
        cred: proof.cred as string,
        ad: proof.ad as string,
        cd: proof.cd as string,
        sig: proof.sig as string,
      };
      if (!(await keyUsable(k)))
        throw new HttpError(422, { reason: "bad_key", detail: "the key is in a shape no machine can use" });
      const v = await verifyEnrollment({ machine: machine.id, code: pairing.code, key: k, proof: p, rpId });
      if (!v.ok) throw new HttpError(422, { reason: "bad_proof", detail: v.why });
      const name = str(body.name, 80) ? (body.name as string).trim() : undefined;
      const by = str(body.by, 200) ? (body.by as string) : "sessionpipe-gui";
      state.approvePairing(
        machine,
        pairing,
        { ...k, addedAt: new Date().toISOString(), ...(name ? { name } : {}) },
        p,
        by,
      );
      return { status: 200, json: { ok: true, machineId: machine.id, keyId: k.id, firstPairing: !machine.tokenHash } };
    }),
  );

  // The pairing is dropped: the terminal's next status poll gets 404 and stops.
  router.post(
    `${base}/pair/:code/reject`,
    guarded((ctx): Reply => {
      const found = CODE_RE.test(ctx.params.code ?? "") ? state.findPairing(ctx.params.code!) : undefined;
      if (!found) throw new HttpError(404, { reason: "not_found" });
      state.dropPairing(found.machine, found.pairing);
      return { status: 204 };
    }),
  );

  // CONTROL.md §3, §5: the browser signed `cmd`; the verifier is our early word, against
  // the machine's enrolled keys, the exact bytes, with the receiver's ten-minute window.
  router.post(
    `${base}/send`,
    guarded(async (ctx): Promise<Reply> => {
      const body = await ctx.json<{
        machineId?: unknown;
        cmd?: unknown;
        csig?: unknown;
        grant?: unknown;
        confirm?: unknown;
        expires_in_s?: unknown;
      }>(256 * 1024);
      if (typeof body.machineId !== "string" || !MACHINE_RE.test(body.machineId))
        throw new HttpError(400, { reason: "bad_request", error: "Which machine?" });
      const m = state.machine(body.machineId);
      if (!m) throw new HttpError(404, { reason: "not_found", error: "No such machine." });
      if (typeof body.cmd !== "string")
        throw new HttpError(400, { reason: "bad_request", error: "cmd is the signed command string." });
      const signed: SignedCommand = { cmd: body.cmd };
      if (typeof body.csig === "string") signed.csig = body.csig;
      if (body.grant && typeof body.grant === "object") signed.grant = body.grant as SignedCommand["grant"];
      if (body.confirm && typeof body.confirm === "object") signed.confirm = body.confirm as SignedCommand["confirm"];
      const verdict = await verifyCommand(signed, {
        machine: m.id,
        rpId,
        trusted: m.keys,
        now: Date.now(),
        maxAgeMs: RECEIVER_MAX_AGE_MS,
      });
      if (!verdict.ok) throw new HttpError(422, { reason: verdict.why, code: verdict.code });
      const ttl = typeof body.expires_in_s === "number" && body.expires_in_s > 0 ? body.expires_in_s * 1000 : undefined;
      const row = state.enqueue(m, signed, verdict.cmd, { via: "ui", ...(ttl ? { expiresInMs: ttl } : {}) });
      return { status: 201, json: toActivity(row) };
    }),
  );

  router.get(
    `${base}/activity`,
    guarded((ctx): Reply => {
      const asked = Number(ctx.url.searchParams.get("limit") ?? 100);
      const limit = Number.isFinite(asked) ? Math.max(1, Math.min(1000, Math.floor(asked))) : 100;
      return { status: 200, json: { activity: state.activity(limit) } };
    }),
  );

  router.get(
    `${base}/machines`,
    guarded(
      (): Reply => ({
        status: 200,
        json: {
          machines: state
            .allMachines()
            .filter((m) => m.tokenHash || m.keys.length)
            .map((m) => ({
              name: m.name,
              createdAt: m.createdAt,
              ...(m.pairedAt ? { pairedAt: m.pairedAt } : {}),
              ...state.machineControl(m),
            })),
        },
      }),
    ),
  );

  // Local only: the row, its token and its queue go; the machine's next poll gets 401
  // and the daemon says so. Keys are never removed one at a time here (CONTROL.md §2).
  router.post(
    `${base}/machines/:id/forget`,
    guarded((ctx): Reply => {
      const id = ctx.params.id ?? "";
      if (!MACHINE_RE.test(id) || !state.removeMachine(id)) throw new HttpError(404, { reason: "not_found" });
      return { status: 204 };
    }),
  );
}
