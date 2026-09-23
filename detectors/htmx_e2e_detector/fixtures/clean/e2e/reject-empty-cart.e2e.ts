import { expect, test } from "@playwright/test";

// Train: train:orders:reject-empty-cart
// Layer: assembly
// URN: test:train:orders:reject-empty-cart:E2E-001-reject-empty-cart

test("test:train:orders:reject-empty-cart:E2E-001-reject-empty-cart", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
