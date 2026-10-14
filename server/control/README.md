# server/control — the receiver side of CONTROL.md

What a paired machine's daemon talks to (`/api/sessionpipe/v1/control`, HTTP.md §3) and
what the board's browser calls (`/api/ui/control/*`). The machine wire is the spec's;
this file documents the UI routes, which are ours.

Every UI route needs the UI's own auth (`deps.uiAuth`: loopback, or the `spgui` cookie);
otherwise `401 {"reason":"unauthorized"}`. All bodies and answers are JSON. Errors are
`{ reason, error? | detail? }`.

## Pairing

A terminal ran `sessionpipe control pair <this receiver>`. It printed a link
(`/pair?code=…`) and six digits; the page shows the same digits, and the person confirms
with a passkey. Open pairing is on: a daemon with no sink token can pair too (it sent a
`poll_key`; the paired answer then also carries our sink token).

| Route | Body → answer |
|---|---|
| `GET /pairings` | `{ pairings: Pairing[] }` — every pairing still waiting for approval, newest first |
| `GET /pair/:code` | `Pairing` for the approval page; `404` unknown code |
| `POST /pair/:code/approve` | `{ key: {id, alg, spki}, proof: {cred, ad, cd, sig}, name?, by? }` → `200 { ok, machineId, keyId, firstPairing }` |
| `POST /pair/:code/reject` | → `204`; the terminal's next status poll gets 404 and stops |
| `GET /challenge` | `{ challenge, rpId, origin, expiresAt }` — a random challenge for a WebAuthn ceremony that has none of its own (making a passkey with `navigator.credentials.create()`), remembered five minutes |

```ts
interface Pairing {
  code: string;
  check: string;                       // the six digits
  status: "pending" | "approved" | "expired" | "done";
  open: boolean;                       // started with a poll_key, no sink token
  fromIp: string;                      // where the request came from (CONTROL.md §2)
  startedAt: string; expiresAt: string;
  machine: { id: string; name: string; harnesses: string[]; modes: string[]; version: string;
             folders?: string[]; mode?: "safe" | "auto";
             accounts?: { harness: string; id: string; email: string }[];
             firstPairing: boolean;    // no token yet: approving hands the machine its token
             keys: number };           // passkeys already trusted for it
  rpId: string;
  challenge: string;                   // base64url(sha256("sessionpipe.pair:" + machine + ":" + code))
}
```

**Approve.** The page calls `navigator.credentials.get()` with `challenge` (decoded from
base64url) and `rpId`, and posts the key it used (`id` = credential id base64url, `alg`
= `-7` or `-257`, `spki` = the public key's SPKI base64url, as kept from when the passkey
was made) with the assertion's `cred`/`ad` (authenticatorData)/`cd` (clientDataJSON)/`sig`
(signature), all base64url. `name` is what to call the device ("iPhone"); `by` is shown
to the terminal as who approved (open pairing: `account`). The receiver verifies the
proof with the core verifier (`verifyEnrollment`); a proof that does not verify is
`422 {"reason":"bad_proof","detail"}`, an unusable key `422 bad_key`, an expired code
`410`, a code already approved `409`. On success the key is trusted for the machine, and
the daemon's next status poll collects key, proof and (first pairing) its token.

Keys are never removed here, one at a time or otherwise (CONTROL.md §2): that is
`sessionpipe control keys remove` at the machine's own terminal. `forget` below drops the
whole machine row locally.

## Sending a command

The browser writes the command string (`cmd`, CONTROL.md §3.1, `machine` = the machine's
id) and signs it: with a day key under a passkey grant (`csig` + `grant`), or with one
passkey confirm over `sha256(cmd)` (`confirm`). The receiver runs the core verifier as
its early word (§5: against the machine's enrolled keys, the exact bytes, a ten-minute
age window, no nonce store) and only then queues it.

| Route | Body → answer |
|---|---|
| `POST /send` | `{ machineId, cmd, csig?, grant?, confirm?, expires_in_s? }` → `201 ControlActivity`; `422 { reason, code }` with the verifier's code (`unsigned`, `untrusted_key`, `bad_csig`, `too_old`, …) when it refuses; `404` unknown machine |
| `GET /activity?limit=` | `{ activity: ControlActivity[] }`, newest first (default 100, at most 1000) |
| `GET /machines` | `{ machines: (MachineControl & { name, createdAt, pairedAt? })[] }` — paired machines |
| `POST /machines/:id/forget` | → `204`; the row, its token and its queue are gone here; its next poll is 401 and the daemon says so |

`expires_in_s` defaults to one hour and is capped at 24 h (§3.3). `ControlActivity`
(`shared/api.ts`) is the receiver's reading of a carried message — never the signature:
`outcome` moves through `taken` / `progress` (with `reply` and `replySeq`, the highest
kept) to a final `delivered` / `expired` / `unsupported` / `failed` / `refused` (with
`code`), `mode` says how it was delivered. The same objects arrive on the SSE stream as
`{ kind: "control", message }` whenever one is queued, acked or expires.

For a `permission.answer`, `text` is `"<decision>"` or `"<decision>: <note>"`; for a
`key.add`, `"trust <name>"`.

## The machine wire (for reference)

`POST {control}/pair` (sink token, or none + `poll_key`) → 201 `control-pair-started`;
`GET {control}/pair?code=` (sink token or the poll key) → `pending` / `paired` (key,
proof, `token` on the first pairing; open pairing adds `sink_token` and `account`) /
`expired`; 404 once the paired answer was handed over, or for a code never seen. A new
`POST pair` naming an existing `machine` renews the code on the same row; the old code
answers `expired`. `POST hello` 204, `GET ?machine=&wait=` 200/204 (wait ≤ 25 s),
`POST ack` 202 `{ applied, unknown }`, `POST off` 204 — each with the machine's own
token and nothing else. A `taken` ack pauses redelivery 35 minutes; a final ack ends it;
duplicates are tolerated. State lives under `<stateDir>/control/` (`machines.json` with
hashed tokens and `queue/<machine id>.json`).

## Test door

With `testDoor: true` and only from loopback: `POST {control}/_test/enroll`,
`_test/enqueue`, `_test/approve` — what the conformance runner (`server/conformance/`)
uses for the control scenarios. See `testdoor.ts`.
