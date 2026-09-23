import { expect, test } from "@playwright/test";

// Train: train:orders:ghost
// Layer: assembly
// URN: test:train:orders:ghost:E2E-010-ghost

test("test:train:orders:ghost:E2E-010-ghost", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
