import { expect, test } from "@playwright/test";

// Train: train:orders:place-order
// Layer: assembly
// URN: test:train:orders:place-order:E2E-001-place-order

test("test:train:orders:place-order:E2E-001-place-order", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
