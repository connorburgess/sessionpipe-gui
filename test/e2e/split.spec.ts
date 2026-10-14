// SPDX-License-Identifier: Apache-2.0
/// <reference lib="dom" />
// The side panel: a session open beside the page. Shift-click on a board card opens it
// (URL `?s=`, the page shrinks), reload keeps it, Esc closes it, the divider resizes it,
// a theme opens it through api.openSession({ split: true }); on a phone it is a sheet.
import { expect, type Page, test } from "@playwright/test";
import { openBoard } from "./helpers.js";

const panel = (page: Page) => page.locator("aside.panel");
const mainWidth = (page: Page) => page.locator("main.main").evaluate((el) => el.getBoundingClientRect().width);
const live = (page: Page) => expect(page.locator(".conn").first()).toHaveText("live", { timeout: 15_000 });

/** Shift-clicks the first board card; returns its title. */
async function openBeside(page: Page): Promise<string> {
  await openBoard(page);
  const card = page.locator("article.card").first();
  const title = (await card.locator(".card-title").textContent())!;
  await card.locator("a.card-link").click({ modifiers: ["Shift"] });
  await expect(panel(page)).toHaveClass(/panel--open/);
  await expect(panel(page).locator(".panel-title")).toHaveText(title);
  await expect(page).toHaveURL(/[?&]s=[^&]+(:|%3A)/);
  return title;
}

test.describe("split panel", () => {
  test.describe("desktop", () => {
    test.skip(({ isMobile }) => !!isMobile, "desktop project only");

    test("shift-click opens beside, the page shrinks, reload keeps it, Esc closes it", async ({ page }) => {
      await openBoard(page);
      const before = await mainWidth(page);
      const title = await openBeside(page);
      // The session view inside opens with its own scrolling and its latest events.
      await expect(panel(page).locator("ol.timeline li.turn").first()).toBeVisible();
      await expect(panel(page).locator(".sess-counts-ev")).toHaveText(/events$/);
      await expect.poll(() => mainWidth(page)).toBeLessThan(before - 300);
      const url = page.url();

      await page.reload();
      await live(page);
      await expect(panel(page)).toHaveClass(/panel--open/);
      await expect(panel(page).locator(".panel-title")).toHaveText(title);
      expect(page.url()).toBe(url);

      await page.keyboard.press("Escape");
      await expect(panel(page)).not.toHaveClass(/panel--open/);
      await expect(page).not.toHaveURL(/[?&]s=/);
      await expect.poll(() => mainWidth(page)).toBeGreaterThan(before - 2);
      // Back brings it back, forward closes it again.
      await page.goBack();
      await expect(panel(page)).toHaveClass(/panel--open/);
      await page.goForward();
      await expect(panel(page)).not.toHaveClass(/panel--open/);
    });

    test("the divider resizes the panel and the width is remembered", async ({ page }) => {
      await openBeside(page);
      // Let the slide-in finish: the grip's position is only right once the panel is still.
      const box = (await panel(page).boundingBox())!;
      await expect
        .poll(async () => Math.round((await panel(page).boundingBox())!.x))
        .toBe(Math.round(page.viewportSize()!.width - box.width));
      const g = (await page.locator(".panel-grip").boundingBox())!;
      const x = g.x + g.width / 2;
      await page.mouse.move(x, g.y + 300);
      await page.mouse.down();
      await page.mouse.move(x - 60, g.y + 300, { steps: 4 });
      await page.mouse.move(x - 120, g.y + 300, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => (await panel(page).boundingBox())!.width).toBeGreaterThan(box.width + 100);
      const wider = (await panel(page).boundingBox())!;
      expect(wider.width).toBeLessThan(box.width + 140);
      await page.reload();
      await live(page);
      const kept = (await panel(page).boundingBox())!;
      expect(Math.abs(kept.width - wider.width)).toBeLessThanOrEqual(1);
    });

    test("another session swaps the content; the header opens the session as a page", async ({ page }) => {
      await openBeside(page);
      const second = page.locator("article.card").nth(1);
      if ((await second.count()) > 0) {
        // Cards re-sort live, so alt-click the one whose href was read, not "the second".
        const href2 = (await second.locator("a.card-link").getAttribute("href"))!;
        const link2 = page.locator(`a.card-link[href="${href2}"]`);
        const title2 = (await link2.locator(".card-title").textContent())!;
        await link2.click({ modifiers: ["Alt"] });
        await expect(panel(page).locator(".panel-title")).toHaveText(title2);
        await expect(page).toHaveURL(/[?&]s=/);
      }
      const open = panel(page).getByRole("link", { name: "Open as page" });
      const href = (await open.getAttribute("href"))!;
      await open.click();
      await expect(page).toHaveURL((u) => u.pathname + u.search === href);
      await expect(page.locator("h1.sess-title")).toBeVisible();
      await expect(panel(page)).not.toHaveClass(/panel--open/);
    });

    test("a theme opens the panel through api.openSession({ split: true, from })", async ({ page }) => {
      await page.goto("/t/e2e-counter");
      await live(page);
      await expect(page.locator("[data-open-split]")).toBeVisible();
      await page.locator("[data-open-split]").click();
      await expect(panel(page)).toHaveClass(/panel--open/);
      await expect(page).toHaveURL(/\/t\/e2e-counter\?s=/);
      await expect(panel(page).locator("ol.timeline")).toBeVisible();
      // The theme's own container made room (after the 240 ms slide).
      const viewport = page.viewportSize()!.width;
      await expect.poll(() => mainWidth(page)).toBeLessThan(viewport - 400);
    });
  });

  test.describe("phone", () => {
    test.skip(({ isMobile }) => !isMobile, "phone project only");

    test("the panel is a sheet covering the view; close returns to the board", async ({ page }) => {
      await openBoard(page);
      const card = page.locator("article.card").first();
      const title = (await card.locator(".card-title").textContent())!;
      await card.locator("a.card-link").click({ modifiers: ["Shift"] });
      const sheet = panel(page);
      await expect(sheet).toHaveClass(/panel--open/);
      await expect(sheet.locator(".panel-title")).toHaveText(title);
      await expect(sheet.locator("ol.timeline li.turn").first()).toBeVisible();
      const box = (await sheet.boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.width).toBeGreaterThanOrEqual(vp.width - 1);
      expect(box.height).toBeGreaterThanOrEqual(vp.height - 1);
      await sheet.getByRole("button", { name: "Close panel" }).click();
      await expect(sheet).not.toHaveClass(/panel--open/);
      await expect(page).not.toHaveURL(/[?&]s=/);
      await expect(page.locator("section.group").first()).toBeVisible();
    });
  });
});
