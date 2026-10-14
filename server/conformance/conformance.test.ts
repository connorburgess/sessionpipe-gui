// SPDX-License-Identifier: Apache-2.0
// Boots the whole app in-process (createApp) with the test door and runs every delivery
// fixture of the sessionpipe checkout against it. The sessionpipe repo is found at
// $SESSIONPIPE_REPO, else ../sessionpipe beside this repo; without it the suite is
// skipped and says so.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type App, type AppOptions, createApp } from "../app.js";
import { type RunReport, runDelivery } from "./runner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.SESSIONPIPE_REPO ?? path.resolve(here, "../../../sessionpipe");
const fixtures = path.join(repo, "conformance/delivery");
const present = existsSync(fixtures);
const files = present
  ? readdirSync(fixtures)
      .filter((f) => f.endsWith(".json"))
      .sort()
  : [];

if (!present)
  console.log(`conformance: no fixtures at ${fixtures} — set SESSIONPIPE_REPO to a sessionpipe checkout to run them`);

describe.skipIf(!present)("conformance/delivery against createApp", () => {
  let app: App;
  let stateDir: string;
  let report: RunReport;

  beforeAll(async () => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), "spgui-conformance-"));
    const opts: AppOptions & { testDoor: boolean } = {
      port: 0,
      host: "127.0.0.1",
      stateDir,
      testDoor: true,
      outbox: false,
      demo: false,
      quiet: true,
    };
    app = await createApp(opts);
    const cfg = JSON.parse(readFileSync(path.join(stateDir, "config.json"), "utf8")) as { sinkToken: string };
    report = await runDelivery(fixtures, { url: app.url, token: cfg.sinkToken, testDoor: true });
    console.log(`\n${report.table}\n${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped\n`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  for (const f of files)
    it(f, () => {
      const r = report.results.find((x) => x.file === f);
      expect(r, "no result").toBeDefined();
      if (r!.skipped) return;
      expect(r!.ok, r!.why).toBe(true);
    });

  it("runs every fixture", () => {
    expect(report.results.map((r) => r.file)).toEqual(files);
  });
});
