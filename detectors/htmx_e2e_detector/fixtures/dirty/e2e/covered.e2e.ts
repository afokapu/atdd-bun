import { expect, test } from "@playwright/test";

// Train: train:orders:covered
// Layer: assembly
// URN: test:train:orders:covered:E2E-001-covered

test("test:train:orders:covered:E2E-001-covered", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
