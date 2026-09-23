import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:RESP-001-only-desktop

test("test:journey:buy:RESP-001-only-desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
