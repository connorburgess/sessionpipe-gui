// SPDX-License-Identifier: Apache-2.0
/// <reference lib="dom" />
// One session: the timeline, the tier lens, follow, back, and Forget.
import { expect, type Page, test } from "@playwright/test";
import { openBoard } from "./helpers.js";

/** Opens the first working card from the board and returns its href. */
async function openWorking(page: Page): Promise<string> {
  await openBoard(page);
  const link = page.locator("article.card--working a.card-link").first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  const href = (await link.getAttribute("href"))!;
  // Cards re-sort live, so click the one whose href we read rather than "the first".
  await page.locator(`a.card-link[href="${href}"]`).click();
  await expect(page).toHaveURL(href);
  await expect(page.locator("h1.sess-title")).toBeVisible();
  return href;
}

const lens = (page: Page, tier: 0 | 1 | 2 | 3) =>
  page.locator("fieldset.seg label.seg-opt").filter({ hasText: new RegExp(`^${tier}$`) });

test.describe("session page", () => {
  test("shows the timeline with turns and tool rows; the tier lens hides and reveals", async ({ page }) => {
    await openWorking(page);
    await expect(page.locator("ol.timeline li.turn").first()).toBeVisible();
    await expect(page.locator("li.tool").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".sess-counts-ev")).toHaveText(/^[1-9]\d* events$/);
    // Lens 3 (default for a tier-3 session): tool rows expand to input and output.
    await expect(lens(page, 3)).toHaveClass(/seg-on/);
    const expandable = page.locator("li.tool.tool--x details");
    await expect(expandable.first()).toBeVisible();
    const first = expandable.first();
    await first.locator("summary").click();
    await expect(first).toHaveAttribute("open", "");
    await expect(first.locator(".tool-io .tool-io-label").first()).toHaveText(/input|output|error/);
    await expect(first.locator(".tool-io pre").first()).toBeVisible();

    // Lens 0: presence only, no tool rows; the hint says how many were hidden.
    await lens(page, 0).click();
    await expect(lens(page, 0)).toHaveClass(/seg-on/);
    await expect(page.locator("li.tool")).toHaveCount(0);
    await expect(page.locator(".lens-hint")).toHaveText(/presence · \d+ hidden/);
    await expect(page.locator("ol.timeline li.turn").first()).toBeVisible();

    // Lens 1: tool names come back, but without input/output to expand.
    await lens(page, 1).click();
    await expect(page.locator("li.tool").first()).toBeVisible();
    await expect(page.locator(".lens-hint")).toHaveText(/^actions/);
    const expandableAt1 = await page.locator("li.tool.tool--x").count();
    const errorsAt1 = await page.locator("li.tool .tool-err").count();
    expect(expandableAt1, "at tier 1 only a failed tool has something to open (its error)").toBeLessThanOrEqual(
      errorsAt1,
    );
    await expect(page.locator("li.tool .tool-io")).toHaveCount(0);
  });

  test("follow toggles and back returns to the board", async ({ page }) => {
    await openWorking(page);
    const follow = page.getByRole("button", { name: /^Follow(ing)?$/ });
    if (await follow.isVisible()) {
      await expect(follow).toHaveAttribute("aria-pressed", "true");
      await follow.click();
      await expect(follow).toHaveAttribute("aria-pressed", "false");
      await expect(follow).toHaveText("Follow");
      await follow.click();
      await expect(follow).toHaveAttribute("aria-pressed", "true");
      await expect(follow).toHaveText("Following");
    } else {
      test.info().annotations.push({
        type: "note",
        description: "the session had already gone idle, so the Follow button (live sessions only) was not shown",
      });
    }
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("section.group").first()).toBeVisible();
  });

  test("Forget asks first, then POSTs and removes the session from the board", async ({ page, request }) => {
    await openBoard(page);
    // A done session (the demo's backfill) is quiet, so once forgotten it stays gone.
    const toggle = page.locator("section.group--done button.group-toggle");
    await toggle.click();
    const first = page.locator("section.group--done article.card--done a.card-link").first();
    await expect(first).toBeVisible();
    const href = (await first.getAttribute("href"))!;
    const [, harness, id] = /^\/s\/([^/]+)\/(.+)$/.exec(href)!.map(decodeURIComponent) as [string, string, string];
    // The done list re-sorts as sessions end, so click the card by its href, not its position.
    await page.locator(`a.card-link[href="${href}"]`).click();
    await expect(page).toHaveURL(href);

    await page.getByRole("button", { name: "Forget" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Forget this session?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete everything held for this session here?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(href);

    await page.getByRole("button", { name: "Forget" }).click();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/forget")),
      page.getByRole("alertdialog").getByRole("button", { name: "Forget" }).click(),
    ]);
    expect(res.status()).toBe(204);
    expect(decodeURIComponent(res.url())).toContain(`/api/ui/sessions/${harness}/${id}/forget`);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(`a.card-link[href="${href}"]`)).toHaveCount(0);
    await page.locator("section.group--done button.group-toggle").click();
    await expect(page.locator(`a.card-link[href="${href}"]`)).toHaveCount(0);
    const gone = await request.get(`/api/ui/sessions/${encodeURIComponent(harness)}/${encodeURIComponent(id)}`);
    expect(gone.status()).toBe(404);
  });
});
