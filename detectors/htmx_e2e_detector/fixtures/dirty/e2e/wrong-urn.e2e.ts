import { expect, test } from "@playwright/test";

// Train: train:orders:covered
// Layer: assembly
// URN: test:train:orders:uncovered:E2E-006-wrong-subject

test("test:train:orders:uncovered:E2E-006-wrong-subject", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
