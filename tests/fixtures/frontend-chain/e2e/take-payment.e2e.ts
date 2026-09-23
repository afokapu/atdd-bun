import { expect, test } from "@playwright/test";

// Train: train:orders:take-payment
// Layer: assembly
// URN: test:train:orders:take-payment:E2E-001-takes-payment

test("test:train:orders:take-payment:E2E-001-takes-payment", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Payment received");
});
