// URN: test:orders:checkout:E027-INPUT-001
// Acceptance: acc:orders:E027-INPUT-001
// Phase: UNIT
// Layer: domain
import { it, expect } from "bun:test";
it("accepts a good payload", () => {
  const parsed = parseOrder({ sku: "x" });
  expect(parsed.sku).toBe("x");
});
