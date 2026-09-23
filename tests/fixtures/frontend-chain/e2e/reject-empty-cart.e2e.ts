import { expect, test } from "@playwright/test";

// Train: train:orders:reject-empty-cart
// Layer: assembly
// URN: test:train:orders:reject-empty-cart:E2E-001-refuses-an-empty-cart

test("test:train:orders:reject-empty-cart:E2E-001-refuses-an-empty-cart", async ({ page }) => {
  await page.goto("/?empty");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("alert")).toHaveText("Your cart is empty");
});
