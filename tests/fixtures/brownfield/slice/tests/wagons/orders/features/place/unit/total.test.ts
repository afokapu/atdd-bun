// URN: test:orders:place:E001-UNIT-001-totals-the-cart
// Acceptance: acc:orders:E001-UNIT-001-totals-the-cart
// WMBT: wmbt:orders:E001
// Phase: UNIT
// Layer: domain
import { describe, expect, it } from "bun:test";
import { total } from "../../../../../../src/wagons/orders/features/place/domain/total";

describe("total", () => {
  // @covers acc:orders:E001-UNIT-001-totals-the-cart
  it("sums the prices of the lines", () => {
    expect(total([{ price: 2 }, { price: 3 }])).toBe(5);
  });
});
