// URN: test:orders:checkout:E007-SMOKE-001
// Acceptance: acc:orders:E007-SMOKE-001
// Phase: SMOKE
// Layer: integration
import { it, expect } from "bun:test";
import { buildOrder } from "../src/build";
it("builds an order", () => {
  const order = buildOrder({ sku: "x" });
  expect(order.sku).toBe("x");
});
