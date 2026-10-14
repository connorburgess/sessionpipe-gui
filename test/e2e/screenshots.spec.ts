// SPDX-License-Identifier: Apache-2.0
/// <reference lib="dom" />
// README screenshots from demo data, dark theme, both projects:
//   SHOTS=1 npx playwright test screenshots
// writes docs/screenshots/{board,session,feed,machines,connect}-{desktop,phone}.png.
// Skipped by default (tag @shots) so the ordinary run stays fast and deterministic.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openBoard, openPage } from "./helpers.js";

const OUT = path.resolve("docs/screenshots");

test.describe("screenshots", { tag: "@shots" }, () => {
  test.skip(!process.env.SHOTS, "set SHOTS=1 to write docs/screenshots/*.png");
  test.use({ colorScheme: "dark" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("sessionpipe-gui.theme", "dark");
      } catch {}
    });
  });

  const shoot = async (page: Page, name: string, device: string) => {
    mkdirSync(OUT, { recursive: true });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Let the ticking clocks and spinners settle one frame before the capture.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await page.screenshot({ path: path.join(OUT, `${name}-${device}.png`), fullPage: false, animations: "disabled" });
  };

  test("board, session, feed, machines, connect", async ({ page, isMobile }) => {
    test.setTimeout(120_000);
    const device = isMobile ? "phone" : "desktop";

    await openBoard(page);
    await expect(page.locator("article.card--working .card-status:has(code)").first()).toBeVisible({
      timeout: 30_000,
    });
    await shoot(page, "board", device);

    const link = page.locator("article.card--working a.card-link").first();
    await link.click();
    await expect(page.locator("h1.sess-title")).toBeVisible();
    await expect(page.locator("li.tool").first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await shoot(page, "session", device);

    await openPage(page, "/feed");
    await expect(page.locator("ol.rows li.ev").nth(8)).toBeVisible();
    await shoot(page, "feed", device);

    await openPage(page, "/machines");
    await expect(page.locator("section.machine").nth(1)).toBeVisible();
    await shoot(page, "machines", device);

    await openPage(page, "/connect");
    await expect(page.locator(".cmd-text")).toContainText("sessionpipe sink add");
    const img = page.getByRole("img", { name: /^QR code/ });
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await shoot(page, "connect", device);
  });
});
