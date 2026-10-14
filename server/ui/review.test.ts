// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Digest, type FilesPage, ROUTES, type SearchPage, sessionKey } from "../../shared/api.js";
import { Session, tempDir } from "../../test/events.js";
import { type App, createApp } from "../app.js";
import { dayBounds, localDay } from "../store/review.js";
import { PREVIEW_CHARS } from "../store/slim.js";

let app: App;
let tmp: { dir: string; cleanup: () => void };

const SID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const SID_B = "bbbbbbbb-0000-4000-8000-000000000002";
const SID_C = "cccccccc-0000-4000-8000-000000000003";
const KEY_A = sessionKey("claude-code", SID_A);
const KEY_B = sessionKey("codex", SID_B);
const KEY_C = sessionKey("claude-code", SID_C);

/** 2026-03-10, from 09:00 UTC. */
const DAY = Date.UTC(2026, 2, 10, 9, 0, 0);

const get = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const res = await fetch(`${app.url}${path}`);
  return { status: res.status, body: (await res.json()) as T };
};

beforeAll(async () => {
  tmp = tempDir();
  app = await createApp({ port: 0, stateDir: tmp.dir, outbox: false, quiet: true });
  const billing = { machine: "studio-mac", repo: "github.com/acme/billing", cwd: "~/code/billing" };
  const infra = { machine: "build-box", repo: "github.com/acme/infra", cwd: "~/work/infra" };

  // A: a Claude Code session on billing with one long transcript (the needle only past the preview).
  const a = new Session(SID_A, "claude-code", DAY);
  const filler = "the quick brown fox jumps over the lazy dog. ".repeat(60); // 2 700 chars, past PREVIEW_CHARS
  expect(filler.length).toBeGreaterThan(PREVIEW_CHARS);
  app.store.ingest(
    [
      a.ev(
        "session.started",
        { source: "startup" },
        { session: { ...billing, title: "Webhook retry on bad signature" } },
      ),
      a.ev("turn.started", { turn_id: "t1", prompt_chars: 40 }, { session: billing }),
      a.ev("tool.started", { tool: "Grep", call_id: "c1" }, { session: billing }),
      a.ev("tool.ended", { tool: "Grep", call_id: "c1", ms: 12, ok: true }, { session: billing }),
      a.ev("tool.started", { tool: "Edit", call_id: "c2" }, { session: billing }),
      a.ev("tool.ended", { tool: "Edit", call_id: "c2", ms: 30, ok: false, error: "nope" }, { session: billing }),
      a.ev("files.changed", { paths: ["src/webhooks/handler.ts", "src/webhooks/retry.ts"] }, { session: billing }),
      a.ev(
        "turn.transcript",
        {
          turn: 1,
          user: "Make a bad signature a hard stop.",
          assistant: `${filler}Found it: SignatureVerificationError.`,
        },
        { session: billing },
      ),
      a.ev("turn.ended", { turn_id: "t1", reason: "stop", ms: 8000 }, { session: billing }),
      a.ev("files.changed", { paths: ["src/webhooks/handler.ts"] }, { session: billing }),
      a.ev(
        "attention.needed",
        { kind: "permission", attention_id: "perm-1", tool: "Bash", message: "rm -rf dist" },
        { session: billing },
      ),
    ],
    "http",
  );
  // B: a Codex session on infra, touching one of the same path names, the same day, later.
  const b = new Session(SID_B, "codex", DAY + 3 * 3600_000);
  app.store.ingest(
    [
      b.ev("session.started", { source: "startup" }, { session: { ...infra, title: "pnpm cache" } }),
      b.ev("turn.started", { turn_id: "t1" }, { session: infra }),
      b.ev("files.changed", { paths: ["src/webhooks/handler.ts", ".github/workflows/ci.yml"] }, { session: infra }),
      b.ev("context.compacted", { reason: "auto" }, { session: infra }),
      b.ev("turn.ended", { turn_id: "t1", reason: "stop" }, { session: infra }),
    ],
    "http",
  );
  // C: the next day (UTC) at 01:00, still "the same day" for a place 3 hours behind UTC.
  const c = new Session(SID_C, "claude-code", DAY + 16 * 3600_000);
  app.store.ingest(
    [
      c.ev("session.started", { source: "startup" }, { session: { ...billing, title: "Late night" } }),
      c.ev("turn.started", { turn_id: "t1" }, { session: billing }),
      c.ev("turn.ended", { turn_id: "t1", reason: "stop" }, { session: billing }),
    ],
    "http",
  );
});
afterAll(async () => {
  await app.close();
  tmp.cleanup();
});

describe("GET /api/ui/search", () => {
  it("finds a word that is only in the full transcript, past the slim preview", async () => {
    const { status, body } = await get<SearchPage>(`${ROUTES.ui.search}?q=signatureverification`);
    expect(status).toBe(200);
    expect(body.hits).toHaveLength(1);
    const hit = body.hits[0]!;
    expect(hit.field).toBe("assistant");
    expect(hit.event.type).toBe("turn.transcript");
    expect(hit.event.preview?.assistant).toBeGreaterThan(PREVIEW_CHARS);
    // The event in the hit is the slim copy; the snippet comes from the full text.
    expect(String(hit.event.data.assistant)).toHaveLength(PREVIEW_CHARS);
    expect(hit.snippet.slice(hit.match[0], hit.match[1])).toBe("SignatureVerification");
    expect(hit.snippet.startsWith("…")).toBe(true);
    expect(hit.session.key).toBe(KEY_A);
    expect(body.scanned).toBeGreaterThan(0);
  });

  it("matches titles once, tool names, paths and attention messages, newest first, case-insensitively", async () => {
    const title = (await get<SearchPage>(`${ROUTES.ui.search}?q=WEBHOOK%20retry`)).body;
    expect(title.hits.map((h) => h.field)).toEqual(["title"]);
    expect(title.hits[0]!.event.type).toBe("session.started");

    const tool = (await get<SearchPage>(`${ROUTES.ui.search}?q=grep`)).body;
    expect(tool.hits.map((h) => [h.field, h.event.type])).toEqual([["tool", "tool.ended"]]);

    const paths = (await get<SearchPage>(`${ROUTES.ui.search}?q=handler.ts`)).body;
    expect(paths.hits.map((h) => h.session.key)).toEqual([KEY_B, KEY_A, KEY_A]);
    expect(paths.hits.every((h) => h.field === "path" && h.snippet === "src/webhooks/handler.ts")).toBe(true);

    const msg = (await get<SearchPage>(`${ROUTES.ui.search}?q=rm%20-rf`)).body;
    expect(msg.hits.map((h) => h.field)).toEqual(["message"]);

    const user = (await get<SearchPage>(`${ROUTES.ui.search}?q=hard%20stop`)).body;
    expect(user.hits.map((h) => h.field)).toEqual(["user"]);
    expect(user.hits[0]!.snippet).toBe("Make a bad signature a hard stop.");
    const at = user.hits[0]!.snippet.indexOf("hard stop");
    expect(user.hits[0]!.match).toEqual([at, at + 9]);
  });

  it("pages with a cursor and answers an empty query with nothing", async () => {
    const p1 = (await get<SearchPage>(`${ROUTES.ui.search}?q=handler.ts&limit=2`)).body;
    expect(p1.hits).toHaveLength(2);
    expect(p1.cursor).toBeDefined();
    const p2 = (await get<SearchPage>(`${ROUTES.ui.search}?q=handler.ts&limit=2&before=${p1.cursor}`)).body;
    expect(p2.hits).toHaveLength(1);
    expect(p2.hits[0]!.event.id).not.toBe(p1.hits[1]!.event.id);
    expect(p2.cursor).toBeUndefined();
    const empty = (await get<SearchPage>(`${ROUTES.ui.search}?q=%20`)).body;
    expect(empty).toMatchObject({ hits: [], scanned: 0 });
  });
});

describe("GET /api/ui/files", () => {
  it("groups paths by repo, each with the sessions that touched it, newest first", async () => {
    const since = new Date(DAY - 1000).toISOString();
    const { status, body } = await get<FilesPage>(`${ROUTES.ui.files}?since=${encodeURIComponent(since)}`);
    expect(status).toBe(200);
    expect(body.since).toBe(since);
    expect(body.total).toBe(4);
    expect(body.repos.map((r) => r.repo)).toEqual(["github.com/acme/infra", "github.com/acme/billing"]);
    const billing = body.repos[1]!;
    expect(billing.sessions).toBe(1);
    expect(billing.paths.map((p) => [p.path, p.count])).toEqual([
      ["src/webhooks/handler.ts", 2],
      ["src/webhooks/retry.ts", 1],
    ]);
    expect(billing.paths[0]!.sessions).toEqual([
      { key: KEY_A, title: "Webhook retry on bad signature", count: 2, lastAt: billing.paths[0]!.lastAt },
    ]);
    const infra = body.repos[0]!;
    expect(infra.paths.map((p) => p.path)).toEqual(["src/webhooks/handler.ts", ".github/workflows/ci.yml"]);
    expect(infra.paths[0]!.sessions[0]).toMatchObject({ key: KEY_B, title: "pnpm cache", count: 1 });
  });

  it("filters by repo and cuts at since", async () => {
    const since = new Date(DAY - 1000).toISOString();
    const only = (await get<FilesPage>(`${ROUTES.ui.files}?since=${since}&repo=github.com%2Facme%2Finfra`)).body;
    expect(only.repos.map((r) => r.repo)).toEqual(["github.com/acme/infra"]);
    expect(only.total).toBe(2);
    const later = new Date(DAY + 2 * 3600_000).toISOString();
    const recent = (await get<FilesPage>(`${ROUTES.ui.files}?since=${later}`)).body;
    expect(recent.repos.map((r) => r.repo)).toEqual(["github.com/acme/infra"]);
    expect((await fetch(`${app.url}${ROUTES.ui.files}?since=yesterday`)).status).toBe(400);
  });
});

describe("GET /api/ui/digest", () => {
  it("lists the day's sessions with their counts and totals per machine and repo", async () => {
    const { status, body } = await get<Digest>(`${ROUTES.ui.digest}?day=2026-03-10&tz=0`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      day: "2026-03-10",
      tz: 0,
      from: "2026-03-10T00:00:00.000Z",
      to: "2026-03-11T00:00:00.000Z",
    });
    expect(body.sessions.map((s) => s.key)).toEqual([KEY_A, KEY_B]);
    expect(body.sessions[0]).toMatchObject({
      title: "Webhook retry on bad signature",
      harness: "claude-code",
      machine: "studio-mac",
      repo: "github.com/acme/billing",
      events: 11,
      turns: 1,
      tools: 2,
      errors: 1,
      attentions: 1,
      compactions: 0,
      filesTouched: 2,
      activeMs: 10_000,
    });
    expect(body.sessions[1]).toMatchObject({ key: KEY_B, machine: "build-box", compactions: 1, filesTouched: 2 });
    expect(body.totals).toMatchObject({
      name: "all",
      sessions: 2,
      events: 16,
      turns: 2,
      tools: 2,
      errors: 1,
      attentions: 1,
      compactions: 1,
      // handler.ts counted once across both sessions
      filesTouched: 3,
      activeMs: 14_000,
    });
    expect(body.byMachine.map((g) => [g.name, g.sessions, g.events])).toEqual([
      ["studio-mac", 1, 11],
      ["build-box", 1, 5],
    ]);
    expect(body.byRepo.map((g) => g.name)).toEqual(["github.com/acme/billing", "github.com/acme/infra"]);
  });

  it("draws the day's boundary in the caller's time zone", async () => {
    // UTC: the late session is on the 11th.
    const utc = (await get<Digest>(`${ROUTES.ui.digest}?day=2026-03-11&tz=0`)).body;
    expect(utc.sessions.map((s) => s.key)).toEqual([KEY_C]);
    // Three hours behind UTC (tz=180): 01:00Z is still 22:00 on the 10th there.
    const behind = (await get<Digest>(`${ROUTES.ui.digest}?day=2026-03-10&tz=180`)).body;
    expect(behind.from).toBe("2026-03-10T03:00:00.000Z");
    expect(behind.sessions.map((s) => s.key)).toEqual([KEY_A, KEY_B, KEY_C]);
    expect(behind.totals.sessions).toBe(3);
    // Nine hours ahead (tz=-540): the 09:00Z session is 18:00 on the 10th; the 12:00Z one 21:00; the late one the 11th.
    const ahead = (await get<Digest>(`${ROUTES.ui.digest}?day=2026-03-10&tz=-540`)).body;
    expect(ahead.sessions.map((s) => s.key)).toEqual([KEY_A, KEY_B]);
    const empty = (await get<Digest>(`${ROUTES.ui.digest}?day=2026-03-09&tz=0`)).body;
    expect(empty.sessions).toEqual([]);
    expect(empty.totals).toMatchObject({ sessions: 0, events: 0, filesTouched: 0 });
  });

  it("defaults to today in the given zone and rejects a bad day or tz", async () => {
    const today = (await get<Digest>(`${ROUTES.ui.digest}?tz=-120`)).body;
    expect(today.day).toBe(localDay(Date.now(), -120));
    expect((await fetch(`${app.url}${ROUTES.ui.digest}?day=2026-3-1`)).status).toBe(400);
    expect((await fetch(`${app.url}${ROUTES.ui.digest}?day=2026-03-10&tz=abc`)).status).toBe(400);
  });

  it("dayBounds and localDay agree", () => {
    expect(dayBounds("2026-03-10", -420)).toEqual({
      from: Date.UTC(2026, 2, 9, 17),
      to: Date.UTC(2026, 2, 10, 17),
    });
    expect(dayBounds("nope", 0)).toBeNull();
    expect(localDay(Date.UTC(2026, 2, 10, 1), 180)).toBe("2026-03-09");
    expect(localDay(Date.UTC(2026, 2, 10, 23), -120)).toBe("2026-03-11");
  });
});
