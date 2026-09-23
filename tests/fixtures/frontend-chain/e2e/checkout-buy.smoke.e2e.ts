import { expect, test } from "@playwright/test";

// Journey: journey:buy
// Layer: assembly
// URN: test:journey:buy:SMOKE-001-buys-end-to-end

test("test:journey:buy:SMOKE-001-buys-end-to-end", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByText("your order is paid")).toBeVisible();
});
