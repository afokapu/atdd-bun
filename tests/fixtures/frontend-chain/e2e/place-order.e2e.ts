import { expect, test } from "@playwright/test";

// Train: train:orders:place-order
// Layer: assembly
// URN: test:train:orders:place-order:E2E-001-places-an-order

test("test:train:orders:place-order:E2E-001-places-an-order", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Order placed");
});
