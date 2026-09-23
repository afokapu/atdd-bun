import { expect, test } from "@playwright/test";

// Train: train:orders:covered
// Layer: assembly
// URN: test:train:orders:covered:E2E-1-too-short

test("test:train:orders:covered:E2E-1-too-short", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
