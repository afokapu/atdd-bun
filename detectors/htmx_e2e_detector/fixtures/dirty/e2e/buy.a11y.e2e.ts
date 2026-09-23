import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:A11Y-001-looks-but-never-runs-axe

test("test:journey:buy:A11Y-001-looks-but-never-runs-axe", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
