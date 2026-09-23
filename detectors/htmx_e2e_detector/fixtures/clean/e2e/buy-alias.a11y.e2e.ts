import { AxeBuilder as Axe } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:A11Y-002-renamed-import

test("test:journey:buy:A11Y-002-renamed-import", async ({ page }) => {
  await page.goto("/");
  const results = await new Axe({ page }).analyze();
  expect(results.violations).toHaveLength(0);
});
