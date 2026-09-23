import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:RESP-001-fits-every-viewport

const VIEWPORTS = [375, 768, 1280];

for (const width of VIEWPORTS) test(`test:journey:buy:RESP-001-fits-every-viewport @ ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
