// SPDX-License-Identifier: Apache-2.0
/// <reference lib="dom" />
// On a phone (the `phone` project, 390×844): the bottom tab bar is on every page with at
// most five tabs (the rest behind More), nothing scrolls sideways, and the session page's
// control strip sits above the tabs.
import { expect, type Page, test } from "@playwright/test";
import { openBoard } from "./helpers.js";

const noSidewaysScroll = async (page: Page) => {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} must not exceed innerWidth ${innerWidth}`).toBeLessThanOrEqual(
    innerWidth,
  );
};

const tabBarIsOn = async (page: Page) => {
  const bar = page.locator("nav.tabbar");
  await expect(bar).toBeVisible();
  // Never more than five tabs: the first four pages, then More for everything else.
  const tabs = bar.locator(":scope > a.nav-link, :scope > .more > .more-tab");
  expect(await tabs.count()).toBeLessThanOrEqual(5);
  for (const label of ["Board", "Feed", "Machines", "Connect"])
    await expect(bar.getByRole("link", { name: label })).toBeVisible();
  // No tab's label is cut short.
  const clipped = await bar
    .locator(".nav-label")
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
  expect(clipped).toEqual([]);
  const box = (await bar.boundingBox())!;
  const vh = await page.evaluate(() => window.innerHeight);
  expect(box.y + box.height, "the tab bar is pinned to the bottom edge").toBeGreaterThanOrEqual(vh - 1);
  await expect(page.locator("nav.rail")).toBeHidden();
};

test.describe("phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone project only");

  test("tab bar on every page, no horizontal scroll", async ({ page }) => {
    await openBoard(page);
    await tabBarIsOn(page);
    await noSidewaysScroll(page);
    await expect(page.locator("nav.tabbar a[aria-current='page']")).toHaveText(/Board/);
    for (const [path, label, marker] of [
      ["/feed", "Feed", "ol.rows"],
      ["/machines", "Machines", "section.machine"],
      ["/connect", "Connect", ".sect--phone"],
    ] as const) {
      await page.locator("nav.tabbar").getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator(marker).first()).toBeVisible();
      await tabBarIsOn(page);
      await noSidewaysScroll(page);
      await expect(page.locator("nav.tabbar a[aria-current='page']")).toHaveText(new RegExp(label));
    }
  });

  test("every installed view and the quick settings are reachable through More", async ({ page }) => {
    await openBoard(page);
    const bar = page.locator("nav.tabbar");
    const more = bar.getByRole("button", { name: "More" });
    await expect(more).toBeVisible();
    const { themes } = (await (await page.request.get("/api/ui/themes")).json()) as {
      themes: { id: string; name: string; error?: string }[];
    };
    for (const t of themes.filter((x) => !x.error)) {
      await more.click();
      const sheet = page.getByRole("dialog", { name: "More" });
      await expect(sheet).toBeVisible();
      await sheet.locator(`a[data-nav='t:${t.id}']`).click();
      await expect(page).toHaveURL(new RegExp(`/t/${t.id}$`));
      await expect(sheet).toHaveCount(0);
      // The active page lives inside More, so More carries the current mark.
      await expect(bar.locator("[aria-current='page']")).toHaveText(/More/);
      await tabBarIsOn(page);
      await noSidewaysScroll(page);
    }
    // Display opens the quick settings from the sheet; Esc closes the popover.
    await more.click();
    await page
      .getByRole("dialog", { name: "More" })
      .getByRole("button", { name: /Display/ })
      .click();
    const pop = page.getByRole("dialog", { name: "Quick settings" });
    await expect(pop).toBeVisible();
    await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
    await expect(pop.locator(".qs-theme").first()).toHaveText(/Default/);
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    // Esc closes the sheet too.
    await more.click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "More" })).toHaveCount(0);
  });

  test("the session page keeps its control strip above the tab bar", async ({ page }) => {
    await openBoard(page);
    const link = page.locator("article.card a.card-link").first();
    await link.click();
    await expect(page).toHaveURL(/\/s\//);
    await expect(page.locator("h1.sess-title")).toBeVisible();
    await expect(page.locator("ol.timeline li.turn").first()).toBeVisible();
    await tabBarIsOn(page);
    await noSidewaysScroll(page);
    const ctl = page.locator(".sess-ctl");
    await expect(ctl).toBeVisible();
    await expect(ctl.getByRole("form", { name: "Control" })).toBeVisible();
    const check = async () => {
      const c = (await ctl.boundingBox())!;
      const t = (await page.locator("nav.tabbar").boundingBox())!;
      expect(c.y + c.height, `control strip bottom ${c.y + c.height} vs tab bar top ${t.y}`).toBeLessThanOrEqual(
        t.y + 1,
      );
      expect(c.y + c.height, "the strip is on screen, not pushed under the fold").toBeLessThanOrEqual(t.y + 1);
      expect(c.y).toBeGreaterThanOrEqual(0);
    };
    await check();
    // After scrolling to the end of the timeline the sticky strip still sits above the tabs.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await check();
    // The input is reachable and not hidden behind the tab bar.
    const input = ctl.getByRole("textbox", { name: "Message for the next turn" });
    await expect(input).toBeVisible();
    const ib = (await input.boundingBox())!;
    const tb = (await page.locator("nav.tabbar").boundingBox())!;
    expect(ib.y + ib.height).toBeLessThanOrEqual(tb.y);
  });
});
