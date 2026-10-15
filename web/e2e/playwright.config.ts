// SPDX-License-Identifier: Apache-2.0
// Owned by: control-web. A self-contained config for the control e2e: the spec boots its
// own built server on a free port (no webServer here), so it never collides with the
// broader suite's instance or a person's :7373. Run from the repo root:
//   node scripts/build.mjs && npx vite build --config web/vite.config.ts
//   npx playwright test -c web/e2e/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /(control|attach)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "../../test-results/control",
  use: {
    browserName: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
});
