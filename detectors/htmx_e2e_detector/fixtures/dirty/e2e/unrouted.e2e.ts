import { expect, test } from "@playwright/test";

// Train: train:orders:unrouted
// Layer: assembly
// URN: test:train:orders:unrouted:E2E-001-unrouted

test("test:train:orders:unrouted:E2E-001-unrouted", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
