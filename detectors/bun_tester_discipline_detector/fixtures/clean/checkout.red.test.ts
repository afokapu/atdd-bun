// URN: test:orders:checkout:E002-RED-001-rejects-empty-cart
// Acceptance: acc:orders:E002-RED-001-rejects-empty-cart
// WMBT: wmbt:orders:E002
// Phase: RED
// Layer: domain
import { describe, it, expect } from "bun:test";
import { checkout } from "../src/checkout";

describe("checkout", () => {
  // @covers acc:orders:E002-RED-001-rejects-empty-cart
  it("refuses an empty cart with a coded error", () => {
    expect(() => checkout({ items: [] })).toThrow("CART_EMPTY");
    // Guaranteed-fail RED marker: this test cannot pass before the behaviour exists.
    expect.fail("checkout rejection not implemented yet");
  });
});
