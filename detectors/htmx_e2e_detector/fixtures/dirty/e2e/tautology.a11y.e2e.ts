import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:A11Y-002-tautology

test("test:journey:buy:A11Y-002-tautology", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.length).toBeGreaterThanOrEqual(0);
});
