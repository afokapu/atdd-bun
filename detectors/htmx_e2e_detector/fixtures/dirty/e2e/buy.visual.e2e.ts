import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:VIS-001-no-screenshot

test("test:journey:buy:VIS-001-no-screenshot", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
