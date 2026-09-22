// URN: test:orders:checkout:E028-TELEMETRY-001
// Acceptance: acc:orders:E028-TELEMETRY-001
// Phase: UNIT
// Layer: application
import { it, expect } from "bun:test";
it("places the order", () => {
  const out = placeOrder({ sku: "x" });
  expect(out.ok).toBe(true);
});
