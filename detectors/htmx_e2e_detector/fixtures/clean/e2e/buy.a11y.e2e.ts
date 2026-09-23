import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:A11Y-001-no-serious-violations

test("test:journey:buy:A11Y-001-no-serious-violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "critical")).toEqual([]);
});
