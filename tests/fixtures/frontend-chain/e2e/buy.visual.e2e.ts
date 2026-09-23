import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:VIS-001-checkout-page

test("test:journey:buy:VIS-001-checkout-page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot("checkout.png", { maxDiffPixelRatio: 0.01 });
});
