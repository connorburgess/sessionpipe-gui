# sessionpipe-gui · architecture

The GUI is **a sessionpipe receiver with a face**: one Node process, no database, a
live board in the browser. It speaks the whole protocol (`spec/HTTP.md`, `CONTROL.md`
in the sessionpipe repo) so it is also the easiest way to test every feature of the
client against a receiver you can see into.

```
 ┌──────────── this machine ────────────┐      ┌── other machines ──┐
 │ sessionpipe hooks → outbox/*.jsonl    │      │ sessionpipe sinks  │
 │        │ (tailed, zero config)        │      │  POST /events      │
 │        ▼                              │      └─────────┬──────────┘
 │  sessionpipe-gui :7373 ◄──────────────┼────────────────┘
 │   store (JSONL + in-memory index)     │
 │   receiver · control · UI API · SSE   │◄──── phones / laptops on the LAN
 │   static web app (dist/web)           │      http://<lan-ip>:7373/?k=<ui key>
 └───────────────────────────────────────┘
```

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Runtime | Node ≥ 20, ESM, TypeScript, `node:http` | Same floor as sessionpipe; nothing to install beyond `npx` |
| Deps | `sessionpipe-core` (types, `filterEvent`, `Outbox`, control verifier), `qrcode`. Nothing else at runtime | Keep it as light as the client |
| Web | React 18 + Vite, hand-written CSS with design tokens, no component library | Distinctive, fast, small |
| Live updates | SSE `GET /api/ui/stream`: a snapshot first, then deltas | Works through any proxy, reconnects by itself |
| Storage | `~/.local/state/sessionpipe-gui/events/<harness>/<session>.jsonl` (append-only, full events) + an index rebuilt at boot | No DB; `forget` deletes one file |
| Memory | Index holds summaries and *slim* events (tool `input`/`output` cut to a 2 KB preview, `output` kept as length + preview); full data is read back from the file by byte offset on demand | 100k events must fit |
| Sources | (1) HTTP receiver, bearer sink token. (2) Local outbox tailer, like `sessionpipe tail` (`Outbox.read` every 500 ms, tier 3, `source: "outbox"`). (3) Demo generator | Zero config on the dev machine, real protocol from everywhere else. Dedup on (harness, session.id, seq) resolves overlap |
| Auth | Events: `Bearer <sink token>` always. UI API + page: loopback free; otherwise cookie `spgui=<ui key>` set by `?k=`. Well-known: public. Machine calls: the machine's own token | One QR code gets a phone in; the token never has to be typed |
| Readings | State machine in `shared/api.ts` (`needs_you` › `working` › `stale` › `idle` › `done`) | Spec §1: the receiver's reading, shown as such |
| Control | Full receiver side (pair, hello, poll, ack, off, queue, redelivery, `taken` pause); UI signs with WebAuthn passkeys + a day key. `rp_id` is `localhost` by default | Phones need HTTPS for passkeys: that is the `--tls` follow-up, not v1 |
| Conformance | Our own runner for `conformance/delivery/*.json` from a sessionpipe checkout (the upstream runner's receiver mode lands in M3) | We must score 100 % |

## Modules and owners

| Path | Owner | Exports (contract) |
|---|---|---|
| `shared/api.ts` | lead (change by agreement) | Every wire type and route |
| `server/http/router.ts`, `net.ts` | lead | `Router`, `Ctx`, `Reply`, `HttpError`, `isLoopback`, `lanAddresses` |
| `server/app.ts` | server-core | `createApp(opts): App` — the only composition root |
| `server/config.ts` | server-core | state dir, sink token, UI key |
| `server/store/*` | server-core | `Store`: `ingest(events, source) → IngestResult`, `snapshot()`, `session(key)`, `sessionDetail(key, after, limit)`, `feed(query)`, `forget(key)`, `subscribe(listener)`, `stats()`, `close()` |
| `server/receiver/*` | server-core | `registerReceiver(router, deps)`: well-known, events, errors per HTTP.md §2 |
| `server/sources/outbox.ts` | server-core | `startOutboxSource(store, opts) → { stop }` |
| `server/ui/*` | server-core | `registerUi(router, deps)`: info, snapshot, stream (SSE), session, feed, forget, rotate token, demo toggle; `staticFiles(dir)` fallback |
| `server/cli.ts` | server-core | flags, banner with LAN URL + QR + `sink add` line, `--open` |
| `server/control/*` | control | `registerControl(router, deps)`: pair/hello/poll/ack/off, queues, keys, early verify, test door; `ControlState` the UI reads (`machines()`, `activity()`) |
| `server/conformance/*` | control | runner CLI + vitest that boots `createApp` in-process and runs every delivery fixture |
| `server/demo/*` | demo | `startDemo(store, opts) → { stop }`: realistic synthetic sessions through `store.ingest(…, "demo")` |
| `web/*` | web | the app; `web/src/mock/` a mock stream so it runs with no server |

A module touches only its own paths; a change it needs elsewhere is a request to the
owner (in a PR comment, or to the lead). `server/app.ts` wires modules by the exact
function names above.

## The store's readings

- COALESCE the session block (spec §3): a later empty field never blanks a full one;
  `title` keeps the better `title_source` (`custom` > `harness` > `first-ask`).
- `turn.progress` is kept only until its `turn.transcript` or the turn's end.
- An attention is open from `attention.needed` until `attention.cleared` **or the
  session's next hook event** (CONTROL.md §7).
- `currentTool` is the last `tool.started` without its `tool.ended` (by `call_id`,
  else by name), cleared by any `turn.ended`.
- State timers: a `working` session with no event for `STALE_AFTER_MS` becomes
  `stale`; anything silent for `DONE_AFTER_MS` becomes `done`. The store re-evaluates
  on a timer and emits `session` messages.
- `session.forgotten` deletes the file and the index entry, then emits `forgotten`.
- Subagent sessions (`parent_id` set) count toward the parent's `children`.

## UI API (all under `/api/ui`, JSON, see `ROUTES` in `shared/api.ts`)

| Method · path | Returns |
|---|---|
| GET `/info` | `Info` (sink token and UI key only to loopback or an authenticated UI) |
| GET `/snapshot` | `Snapshot` |
| GET `/stream` | SSE of `StreamMessage`; `event:` = kind, `data:` = JSON; first frame a snapshot; a `: ping` comment every 15 s |
| GET `/sessions/:harness/:id?after=<seq>&limit=<n>` | `SessionDetail` (full events, read from disk) |
| GET `/events?limit&before&harness&machine&type&session&q` | `FeedPage`, newest first |
| POST `/sessions/:harness/:id/forget` | 204; same effect as a `session.forgotten` event |
| POST `/token/rotate` | `{ sinkToken }` (loopback only) |
| POST `/demo` `{ on }` | `{ on }` |
| `/control/*` | phase 2 (control agent + web) |

## Running

```sh
npm install
npm run dev            # server :7373 (rebuilt on change) + Vite :5173 proxying to it
npm run build && npm start -- --demo
npm test               # vitest: store, receiver, control, conformance in-process
npm run test:e2e       # playwright against a built server with --demo
```

## Conventions

- SPDX header on every source file; Apache-2.0; commits signed off (DCO).
- Biome for format + lint; `npm run typecheck` must pass for both tsconfigs.
- Tests live beside code as `*.test.ts` or under `test/`.
- No telemetry, ever. Nothing in the web bundle calls anywhere but its own origin.
