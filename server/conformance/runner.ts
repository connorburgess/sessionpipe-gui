// SPDX-License-Identifier: Apache-2.0
// Runs the delivery scenarios of spec/HTTP.md §7 (conformance/delivery/*.json in the
// sessionpipe repo) against a receiver URL. Each fixture is a list of steps; a step is
// one request (send, poll, ack, pair_start, pair_status, hello, off, well_known, read)
// or a test-door call (enqueue, approve) or a pause (wait_s), with an optional
// `expect` of status and a body subset ("*" = any present value).
//
// Placeholders: {run} / {run12} are this scenario's run id (8 and 12 hex characters),
// {poll_key} a random open-pairing secret, {machine} the machine the scenario's last
// pair_start returned (else the run's own test machine), {uuid} a fresh UUID,
// {max_tier} / "{max_tier+1}" the well-known value. In a sent event, "*" for id and
// time becomes a fresh ULID and now.
//
// The control scenarios need the receiver's loopback test door (server/control/
// testdoor.ts); `read` needs this GUI's own session route (/api/ui/sessions). Both are
// this receiver's, so against another receiver those steps report why they can't run.

import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ulid } from "sessionpipe-core";

export interface RunOptions {
  url: string;
  /** The sink token (events, keyed pairing). Scenarios that need it fail without one. */
  token?: string;
  /** Use the receiver's loopback test door for enqueue / approve / machine tokens. */
  testDoor?: boolean;
  fetch?: typeof fetch;
  /** Run only the fixtures whose file name passes. */
  only?: (file: string) => boolean;
}

export interface ScenarioResult {
  file: string;
  name: string;
  ok: boolean;
  skipped?: string;
  why?: string;
  steps: number;
  ms: number;
}

export interface RunReport {
  results: ScenarioResult[];
  table: string;
  failed: number;
  passed: number;
  skipped: number;
}

interface WellKnown {
  protocol?: number[];
  max_tier?: number;
  capabilities?: string[];
  endpoints?: { events?: string; control?: string };
  batch?: { max_events?: number; max_bytes?: number };
  control?: { wait_max_s?: number; open_pairing?: boolean; session_tools?: unknown; signing?: unknown };
}

type Step = Record<string, unknown> & { expect?: { status?: number; body?: unknown } };
interface Fixture {
  name: string;
  spec?: string;
  capability?: string;
  skip_when?: string;
  note?: string;
  steps: Step[];
}

class StepError extends Error {}

/** A body subset check: "*" means any present value; arrays match item by item. */
export function matches(expect: unknown, got: unknown, at = "body"): string | null {
  if (expect === "*") return got === undefined ? `${at}: expected a value` : null;
  if (Array.isArray(expect)) {
    if (!Array.isArray(got)) return `${at}: expected an array`;
    if (got.length !== expect.length) return `${at}: expected ${expect.length} item(s), got ${got.length}`;
    for (let i = 0; i < expect.length; i++) {
      const r = matches(expect[i], got[i], `${at}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (expect && typeof expect === "object") {
    if (!got || typeof got !== "object") return `${at}: expected an object`;
    for (const [k, v] of Object.entries(expect as Record<string, unknown>)) {
      const r = matches(v, (got as Record<string, unknown>)[k], `${at}.${k}`);
      if (r) return r;
    }
    return null;
  }
  return expect === got ? null : `${at}: expected ${JSON.stringify(expect)}, got ${JSON.stringify(got)}`;
}

interface Scenario {
  run: string;
  run12: string;
  pollKey: string;
  uuid: string;
  machine?: string;
  code?: string;
  lastId?: string;
  ackMachine?: string;
  tokens: Map<string, string>;
}

interface Res {
  status: number;
  body: unknown;
}

export async function runDelivery(fixturesDir: string, o: RunOptions): Promise<RunReport> {
  const f = o.fetch ?? fetch;
  const base = o.url.replace(/\/$/, "");
  const files = readdirSync(fixturesDir)
    .filter((n) => n.endsWith(".json") && (!o.only || o.only(n)))
    .sort();
  const results: ScenarioResult[] = [];

  let wk: WellKnown | null = null;
  let wkWhy = "";
  try {
    const r = await f(`${base}/.well-known/sessionpipe`);
    if (r.ok) wk = (await r.json()) as WellKnown;
    else wkWhy = `GET /.well-known/sessionpipe: HTTP ${r.status}`;
  } catch (e) {
    wkWhy = `GET /.well-known/sessionpipe: ${(e as Error).message}`;
  }
  const abs = (ep: string | undefined, fallback: string) =>
    !ep ? `${base}${fallback}` : /^https?:\/\//.test(ep) ? ep : `${base}${ep}`;
  const events = abs(wk?.endpoints?.events, "/api/sessionpipe/v1/events");
  const control = abs(wk?.endpoints?.control, "/api/sessionpipe/v1/control");
  const maxTier = wk?.max_tier ?? 3;
  const maxEvents = wk?.batch?.max_events ?? 50;
  const maxBytes = wk?.batch?.max_bytes ?? 262_144;
  const capabilities = wk?.capabilities ?? [];

  const request = async (
    method: string,
    url: string,
    o2: { bearer?: string; headers?: Record<string, string>; body?: unknown },
  ): Promise<Res> => {
    const headers: Record<string, string> = { ...(o2.headers ?? {}) };
    if (o2.bearer !== undefined && !("authorization" in headers)) headers.authorization = `Bearer ${o2.bearer}`;
    if (o2.body !== undefined && !("content-type" in headers)) headers["content-type"] = "application/json";
    const r = await f(url, { method, headers, body: o2.body !== undefined ? JSON.stringify(o2.body) : undefined });
    const text = await r.text();
    let body: unknown;
    if (text)
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    return { status: r.status, body };
  };

  for (const file of files) {
    const t0 = Date.now();
    let fx: Fixture;
    try {
      fx = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf8")) as Fixture;
    } catch (e) {
      results.push({
        file,
        name: file,
        ok: false,
        why: `unreadable fixture: ${(e as Error).message}`,
        steps: 0,
        ms: 0,
      });
      continue;
    }
    const done = (r: Omit<ScenarioResult, "file" | "name" | "steps" | "ms">) =>
      results.push({ file, name: fx.name, steps: fx.steps?.length ?? 0, ms: Date.now() - t0, ...r });
    if (!wk) {
      done({ ok: false, why: wkWhy });
      continue;
    }
    if (fx.capability && !capabilities.includes(fx.capability)) {
      done({ ok: true, skipped: `capability ${fx.capability} not declared` });
      continue;
    }
    const sw = fx.skip_when && /^(\w+) == (\d+)$/.exec(fx.skip_when);
    if (sw && (wk as Record<string, unknown>)[sw[1]!] === Number(sw[2])) {
      done({ ok: true, skipped: `skip_when ${fx.skip_when}` });
      continue;
    }
    const open = fx.steps.some((s) => (s.pair_start as { auth?: string } | undefined)?.auth === "none");
    if (open && wk.control?.open_pairing !== true) {
      done({ ok: true, skipped: "control.open_pairing not declared" });
      continue;
    }
    const needsDoor = fx.steps.some(
      (s) => "enqueue" in s || "approve" in s || "poll" in s || "ack" in s || "hello" in s || "off" in s,
    );
    if (needsDoor && !o.testDoor) {
      done({ ok: true, skipped: "needs the receiver's loopback test door (--test-door)" });
      continue;
    }

    const hex = randomBytes(6).toString("hex");
    const sc: Scenario = {
      run: hex.slice(0, 8),
      run12: hex,
      pollKey: randomBytes(32).toString("base64url"),
      uuid: randomUUID(),
      tokens: new Map(),
    };
    const defaultMachine = `m_conformance${sc.run}0000`;
    const sub = (v: unknown): unknown => {
      if (typeof v === "string") {
        if (v === "{max_tier+1}") return maxTier + 1;
        if (v === "{max_tier}") return maxTier;
        return v
          .replace(/\{run12\}/g, sc.run12)
          .replace(/\{run\}/g, sc.run)
          .replace(/\{poll_key\}/g, sc.pollKey)
          .replace(/\{uuid\}/g, sc.uuid)
          .replace(/\{machine\}/g, sc.machine ?? defaultMachine);
      }
      if (Array.isArray(v)) return v.map(sub);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
      return v;
    };
    const needToken = (what: string): string => {
      if (!o.token) throw new StepError(`${what} needs the sink token (--token)`);
      return o.token;
    };
    const machineToken = async (machine: string): Promise<string> => {
      const have = sc.tokens.get(machine);
      if (have) return have;
      if (!o.testDoor) throw new StepError(`no token for ${machine}: the test door is off`);
      const r = await request("POST", `${control}/_test/enroll`, { body: { machine } });
      if (r.status !== 201 || typeof (r.body as { token?: unknown })?.token !== "string")
        throw new StepError(`test door enroll for ${machine}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
      const token = (r.body as { token: string }).token;
      sc.tokens.set(machine, token);
      return token;
    };
    const event = (seq: number, extra: Record<string, unknown> = {}) => ({
      protocol: 1,
      id: ulid(),
      type: "session.started",
      time: new Date().toISOString(),
      tier: 0,
      harness: { name: "conformance", event: "test" },
      session: { id: `conf-${sc.run}`, seq },
      privacy: { rulesets: ["secrets@1"], pii: false },
      data: { source: "startup", ...extra },
    });

    const runStep = async (step: Step): Promise<Res | null> => {
      if ("wait_s" in step) {
        await new Promise((r) => setTimeout(r, Number(step.wait_s) * 1000));
        return null;
      }
      if ("well_known" in step) return request("GET", `${base}/.well-known/sessionpipe`, {});
      if ("send" in step) {
        const s = sub(step.send) as { auth?: string; headers?: Record<string, string>; events: unknown };
        let evs: unknown = s.events;
        if (evs === "{max_events+1 events}") evs = Array.from({ length: maxEvents + 1 }, (_, i) => event(i));
        else if (evs === "{one batch over max_bytes}") evs = [event(0, { pad: "x".repeat(maxBytes) })];
        else if (Array.isArray(evs))
          evs = evs.map((e: Record<string, unknown>) => ({
            ...e,
            id: e.id === "*" ? ulid() : e.id,
            time: e.time === "*" ? new Date().toISOString() : e.time,
          }));
        const bearer = s.auth === "wrong" ? `wrong-${randomBytes(8).toString("hex")}` : needToken("send");
        return request("POST", events, {
          bearer,
          headers: { "sessionpipe-protocol": "1", ...(s.headers ?? {}) },
          body: { events: evs },
        });
      }
      if ("read" in step) {
        const s = sub(step.read) as { session: string };
        const i = s.session.indexOf(":");
        return request(
          "GET",
          `${base}/api/ui/sessions/${encodeURIComponent(s.session.slice(0, i))}/${encodeURIComponent(s.session.slice(i + 1))}`,
          {},
        );
      }
      if ("enqueue" in step) {
        const s = sub(step.enqueue) as { machine: string };
        await machineToken(s.machine);
        const r = await request("POST", `${control}/_test/enqueue`, { body: s });
        if (r.status !== 201) throw new StepError(`test door enqueue: HTTP ${r.status} ${JSON.stringify(r.body)}`);
        sc.lastId = (r.body as { id: string }).id;
        sc.ackMachine = s.machine;
        return r;
      }
      if ("poll" in step) {
        const s = sub(step.poll) as { machine: string; wait?: number };
        const r = await request("GET", `${control}?machine=${encodeURIComponent(s.machine)}&wait=${s.wait ?? 1}`, {
          bearer: await machineToken(s.machine),
        });
        const first = (r.body as { messages?: { id?: string }[] } | undefined)?.messages?.[0]?.id;
        if (r.status === 200 && first && !sc.lastId) sc.lastId = first;
        sc.ackMachine = s.machine;
        return r;
      }
      if ("ack" in step) {
        const s = sub(step.ack) as Record<string, unknown>;
        if (!sc.lastId || !sc.ackMachine) throw new StepError("ack before any message was enqueued or polled");
        return request("POST", `${control}/ack`, {
          bearer: await machineToken(sc.ackMachine),
          body: { acks: [{ id: sc.lastId, at: new Date().toISOString(), ...s }] },
        });
      }
      if ("hello" in step) {
        const s = sub(step.hello) as { machine?: string; body?: Record<string, unknown> };
        const machine = s.machine ?? sc.machine ?? defaultMachine;
        const body = s.body ?? {
          name: "conformance",
          harnesses: ["claude-code"],
          modes: ["waiter"],
          keys: [],
          version: "0.0.0",
          waiting: [],
        };
        return request("POST", `${control}/hello`, { bearer: await machineToken(machine), body });
      }
      if ("off" in step) {
        const s = sub(step.off) as { machine?: string };
        const machine = s.machine ?? sc.machine ?? defaultMachine;
        return request("POST", `${control}/off`, { bearer: await machineToken(machine) });
      }
      if ("pair_start" in step) {
        const s = sub(step.pair_start) as { auth?: string; body: Record<string, unknown> };
        const bearer = s.auth === "none" ? undefined : needToken("pair_start");
        const r = await request("POST", `${control}/pair`, { bearer, body: s.body });
        const b = r.body as { machine?: string; code?: string } | undefined;
        if (r.status === 201 && b) {
          if (typeof b.machine === "string") sc.machine = b.machine;
          if (typeof b.code === "string") sc.code = b.code;
        }
        return r;
      }
      if ("pair_status" in step) {
        const s = sub(step.pair_status) as { auth?: string };
        if (!sc.code) throw new StepError("pair_status before a pair_start");
        const bearer =
          s.auth === "none"
            ? undefined
            : s.auth === "wrong_poll_key"
              ? randomBytes(32).toString("base64url")
              : s.auth === "poll_key"
                ? sc.pollKey
                : needToken("pair_status");
        const r = await request("GET", `${control}/pair?code=${encodeURIComponent(sc.code)}`, { bearer });
        const b = r.body as { status?: string; token?: string } | undefined;
        if (r.status === 200 && b?.status === "paired" && typeof b.token === "string" && sc.machine)
          sc.tokens.set(sc.machine, b.token);
        return r;
      }
      if ("approve" in step) {
        const s = sub(step.approve) as { as?: string };
        if (!sc.code) throw new StepError("approve before a pair_start");
        const r = await request("POST", `${control}/_test/approve`, {
          body: { code: sc.code, as: s.as ?? "test-person" },
        });
        if (r.status !== 200) throw new StepError(`test door approve: HTTP ${r.status} ${JSON.stringify(r.body)}`);
        return r;
      }
      throw new StepError(
        `unknown step: ${
          Object.keys(step)
            .filter((k) => k !== "expect")
            .join(", ") || "(empty)"
        }`,
      );
    };

    let why: string | undefined;
    for (const [i, step] of fx.steps.entries()) {
      const kind = Object.keys(step).find((k) => k !== "expect") ?? "?";
      try {
        const r = await runStep(step);
        if (step.expect && r) {
          if (step.expect.status !== undefined && r.status !== step.expect.status) {
            why = `step ${i + 1} ${kind}: status ${r.status}, expected ${step.expect.status} (${JSON.stringify(r.body)?.slice(0, 200)})`;
            break;
          }
          if (step.expect.body !== undefined) {
            const m = matches(sub(step.expect.body), r.body);
            if (m) {
              why = `step ${i + 1} ${kind}: ${m}`;
              break;
            }
          }
        }
      } catch (e) {
        why = `step ${i + 1} ${kind}: ${(e as Error).message}`;
        break;
      }
    }
    done(why ? { ok: false, why } : { ok: true });
  }

  const failed = results.filter((r) => !r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const passed = results.length - failed - skipped;
  const table = results
    .map((r) => {
      const tag = r.skipped ? "skip" : r.ok ? "ok  " : "FAIL";
      const tail = r.skipped ? ` — ${r.skipped}` : r.why ? ` — ${r.why}` : "";
      return `${tag} ${r.file.padEnd(32)} ${r.name.padEnd(24)} ${String(r.steps).padStart(2)} steps ${String(r.ms).padStart(5)} ms${tail}`;
    })
    .join("\n");
  return { results, table, failed, passed, skipped };
}
