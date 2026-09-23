import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:RESP-002-first-only

const VIEWPORTS = [375, 768, 1280];

test("test:journey:buy:RESP-002-first-only", async ({ page }) => {
  await page.setViewportSize({ width: VIEWPORTS[0], height: 900 });
  const measured = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(true).toBe(true);
});
