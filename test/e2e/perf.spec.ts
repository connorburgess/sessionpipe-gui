// SPDX-License-Identifier: Apache-2.0
// Browser memory under load (@perf; off by default, on with SPGUI_PERF=1): the board
// streams two minutes of tier-3 events posted through the receiver on top of the demo
// generator, then the heap is measured after a forced GC and must stay under budget.
// Idle CPU and long tasks are reported, not asserted: the machine running CI decides those.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { EVENTS, INFO, openBoard, ulid } from "./helpers.js";

const MINUTES = 2;
const RATE = 2;
const HEAP_BUDGET_MB = 60;

const lorem = (n: number): string =>
  "the quick brown fox jumps over the lazy dog while editing code ".repeat(Math.ceil(n / 64)).slice(0, n);

/** One streaming session's events: turn → tools → transcript → end, round and round. */
function* session(i: number): Generator<Record<string, unknown>> {
  const id = randomUUID();
  let seq = 0;
  let turn = 0;
  const ev = (type: string, data: Record<string, unknown>) => ({
    protocol: 1,
    id: ulid(),
    type,
    time: new Date().toISOString(),
    tier: 3,
    harness: { name: "claude-code", version: "2.1.296", event: "Hook" },
    session: {
      id,
      seq: seq++,
      machine: "perf-box",
      cwd: "~/perf",
      repo: "github.com/e2e/perf",
      branch: "main",
      title: `Perf ${i}`,
    },
    privacy: { rulesets: ["secrets@1"], pii: false },
    data,
  });
  for (;;) {
    turn++;
    yield ev("turn.started", { turn_id: `t${turn}`, prompt_chars: 120 });
    for (let k = 0; k < 4; k++) {
      yield ev("tool.started", {
        tool: "Read",
        call_id: `c${turn}.${k}`,
        input: { file_path: `/src/${k}.ts`, text: lorem(1200) },
      });
      yield ev("tool.ended", { tool: "Read", call_id: `c${turn}.${k}`, ok: true, ms: 300, output: lorem(3000) });
    }
    yield ev("turn.transcript", { turn, user: lorem(120), assistant: lorem(1500) });
    yield ev("turn.ended", { turn_id: `t${turn}`, reason: "stop", ms: 20_000 });
  }
}

test.describe("@perf", () => {
  test.skip(!process.env.SPGUI_PERF, "perf checks run with SPGUI_PERF=1");
  test.skip(({ browserName }) => browserName !== "chromium", "heap metrics need CDP");

  test(`board heap stays under ${HEAP_BUDGET_MB} MB after ${MINUTES} minutes of streaming @perf`, async ({
    page,
    request,
  }) => {
    test.setTimeout((MINUTES + 2) * 60_000);
    const { sinkToken } = (await (await request.get(INFO)).json()) as { sinkToken: string };
    await openBoard(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");
    const heapMb = async (): Promise<number> => {
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      return (metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1048576;
    };
    const taskS = async (): Promise<number> => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      return metrics.find((m) => m.name === "TaskDuration")?.value ?? 0;
    };
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) w.__long.push(Math.round(e.duration));
      }).observe({ type: "longtask" });
    });
    const start = await heapMb();

    const gens = [session(1), session(2), session(3)];
    let i = 0;
    let posted = 0;
    const until = Date.now() + MINUTES * 60_000;
    while (Date.now() < until) {
      const e = gens[i++ % gens.length]!.next().value;
      const res = await request.post(EVENTS, {
        headers: { authorization: `Bearer ${sinkToken}`, "content-type": "application/json" },
        data: { events: [e] },
      });
      expect(res.ok(), await res.text()).toBe(true);
      posted++;
      await page.waitForTimeout(1000 / RATE);
    }
    const after = await heapMb();

    // A quiet window: nothing posted (the demo still runs), nobody touching the page.
    const t0 = await taskS();
    await page.waitForTimeout(20_000);
    const idleCpuPct = (100 * ((await taskS()) - t0)) / 20;
    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    console.log(
      `[perf] board: heap ${start.toFixed(1)} → ${after.toFixed(1)} MB after ${posted} posted events; idle cpu ${idleCpuPct.toFixed(2)} %; long tasks > 50 ms: ${long.filter((d) => d > 50).length} (max ${Math.max(0, ...long)} ms)`,
    );
    expect(after).toBeLessThan(HEAP_BUDGET_MB);
  });
});
