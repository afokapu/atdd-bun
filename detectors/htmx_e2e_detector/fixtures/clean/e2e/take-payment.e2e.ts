import { expect, test } from "@playwright/test";

// Train: train:orders:take-payment
// Layer: assembly
// URN: test:train:orders:take-payment:E2E-001-take-payment

test("test:train:orders:take-payment:E2E-001-take-payment", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
