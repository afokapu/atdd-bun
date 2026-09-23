import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:SMOKE-001-checkout-renders

test("test:journey:buy:SMOKE-001-checkout-renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
