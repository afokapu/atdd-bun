import { expect, test } from "@playwright/test";

// Train: train:0001-legacy
// Layer: assembly
// URN: test:train:orders:covered:E2E-004-bad-id

test("test:train:orders:covered:E2E-004-bad-id", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
