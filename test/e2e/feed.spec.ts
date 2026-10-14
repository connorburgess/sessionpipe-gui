// SPDX-License-Identifier: Apache-2.0
/// <reference lib="dom" />
// The feed: live rows, Pause with its "N new" pill, Resume, the harness filter, search.
import { expect, test } from "@playwright/test";
import { openPage } from "./helpers.js";

const rows = (page: import("@playwright/test").Page) => page.locator("ol.rows li.ev");

test.describe("feed", () => {
  test("rows arrive live; Pause holds them behind an N-new pill; Resume shows them", async ({ page }) => {
    await openPage(page, "/feed");
    await expect(page.locator("ol.rows")).toHaveAttribute("aria-busy", "false");
    await expect(rows(page).first()).toBeVisible();
    const before = await rows(page).count();
    await expect.poll(() => rows(page).count(), { timeout: 20_000 }).toBeGreaterThan(before);

    const pause = page.getByRole("button", { name: /^Pause$/ });
    await pause.click();
    const resume = page.getByRole("button", { name: /^Resume/ });
    await expect(resume).toHaveAttribute("aria-pressed", "true");
    const pill = resume.locator(".pill-new");
    await expect(pill).toHaveText(/^[1-9]\d* new$/, { timeout: 20_000 });
    const held = await rows(page).count();
    // The pill keeps counting while the list stays put.
    const shown = Number((await pill.innerText()).split(" ")[0]);
    await expect.poll(() => pill.innerText().then((t) => Number(t.split(" ")[0]))).toBeGreaterThan(shown);
    expect(await rows(page).count()).toBe(held);

    const pending = Number((await pill.innerText()).split(" ")[0]);
    await resume.click();
    await expect(page.getByRole("button", { name: /^Pause$/ })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".pill-new")).toHaveCount(0);
    expect(await rows(page).count()).toBeGreaterThanOrEqual(held + pending);
  });

  test("the harness filter restricts rows and search narrows them", async ({ page }) => {
    await openPage(page, "/feed");
    await expect(rows(page).first()).toBeVisible();
    const harness = page.getByRole("combobox", { name: "Harness" });
    await expect(harness).toBeVisible();
    const options = await harness.locator("option").allInnerTexts();
    expect(options).toContain("Codex");
    await harness.selectOption("codex");
    await expect(page.locator("ol.rows")).toHaveAttribute("aria-busy", "false");
    await expect(rows(page).first()).toBeVisible();
    const harnessOf = () =>
      rows(page).evaluateAll((els) => els.map((el) => el.querySelector(".glyph-wrap")?.getAttribute("title") ?? "?"));
    await expect.poll(harnessOf).not.toHaveLength(0);
    expect(new Set(await harnessOf())).toEqual(new Set(["Codex"]));
    // A live row through the filter must be Codex too: wait for one more and check again.
    const n = await rows(page).count();
    await expect.poll(() => rows(page).count(), { timeout: 20_000 }).toBeGreaterThan(n);
    expect(new Set(await harnessOf())).toEqual(new Set(["Codex"]));

    await harness.selectOption("");
    await page.getByRole("searchbox", { name: "Search events" }).fill("session.started");
    await expect(page.locator("ol.rows")).toHaveAttribute("aria-busy", "false");
    await expect(rows(page).first()).toBeVisible();
    const types = await rows(page).evaluateAll((els) => els.map((el) => el.querySelector(".ev-type")?.textContent));
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(["session.started"]));
    await page.getByRole("searchbox", { name: "Search events" }).fill("no-such-thing-zzz");
    await expect(page.getByText("No events match.")).toBeVisible();
  });
});
