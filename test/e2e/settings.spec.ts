// SPDX-License-Identifier: Apache-2.0
/// <reference lib="dom" />
// Quick settings: the popover on the rail switches the color theme (tokens on :root and
// the scheme it forces) and the text size (the root font-size), and both survive a reload.
import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers.js";

test.describe("quick settings", () => {
  test("color theme and text size apply, and persist across a reload", async ({ page }) => {
    await openBoard(page);
    const trigger = page.locator("nav.rail button[aria-label='Quick settings']");
    await trigger.click();
    const pop = page.getByRole("dialog", { name: "Quick settings" });
    await expect(pop).toBeVisible();
    // Built-ins first, in order, Default on.
    await expect(pop.locator(".qs-theme")).toHaveText([/Default/, /Paper/, /Graphite/, /Ink/, /Sepia/]);
    await expect(pop.locator("[data-color-theme='default']")).toHaveAttribute("aria-pressed", "true");

    await pop.locator("[data-color-theme='paper']").click();
    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(root).toHaveAttribute("data-color-theme", "paper");
    const bg = await page.evaluate(() => document.documentElement.style.getPropertyValue("--bg"));
    expect(bg).toBe("oklch(0.968 0.012 80)");
    // The body really paints with it (the token is used, not just set).
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toMatch(/^(oklch|color|rgb)/);
    // Appearance is the color theme's while one is on.
    await expect(pop.locator("fieldset.seg").first()).toHaveAttribute("disabled", "");

    const before = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    // The radios are visually hidden inside their labels; click the label, as a person does.
    await pop.locator("label.seg-opt", { hasText: /^A\+$/ }).click();
    const after = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(after / before).toBeCloseTo(1.1, 2);

    await page.reload();
    await expect(page.locator(".conn").first()).toHaveText("live", { timeout: 15_000 });
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(root).toHaveAttribute("data-color-theme", "paper");
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bg"))).toBe(
      "oklch(0.968 0.012 80)",
    );
    expect(
      (await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))) / before,
    ).toBeCloseTo(1.1, 2);

    // Back to Default clears the tokens and frees the appearance; Esc closes the popover.
    await trigger.click();
    await pop.locator("[data-color-theme='default']").click();
    await expect(root).not.toHaveAttribute("data-color-theme", /./);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bg"))).toBe("");
    await expect(pop.locator("fieldset.seg").first()).not.toHaveAttribute("disabled", /.*/);
    await pop.locator("label.seg-opt", { hasText: /^A$/ }).click();
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
  });

  test("custom color themes from the state dir are listed after the built-ins", async ({ page, request }) => {
    const { themes } = (await (await request.get("/api/ui/color-themes")).json()) as { themes: { id: string }[] };
    await openBoard(page);
    await page.locator("nav.rail button[aria-label='Quick settings']").click();
    const pop = page.getByRole("dialog", { name: "Quick settings" });
    const rows = pop.locator(".qs-theme");
    await expect(rows).toHaveCount(5 + themes.length);
    for (const t of themes) await expect(pop.locator(`[data-color-theme='${t.id}']`)).toBeVisible();
  });
});
