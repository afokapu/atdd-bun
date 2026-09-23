import { expect, test } from "@playwright/test";

// Train: train:orders:place-order
// Layer: assembly
// URN: test:train:orders:place-order:E2E-002-crlf

test("test:train:orders:place-order:E2E-002-crlf", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
