// URN: test:orders:checkout:E023-RED-001-refuses-zero-total
// Acceptance: acc:orders:E023-RED-001-refuses-zero-total
// Phase: RED
// Layer: domain
import { describe, it, expect } from "bun:test";
import { total } from "../src/total";

describe("total", () => {
  // @covers acc:orders:E023-RED-001-refuses-zero-total
  it("refuses a zero total", () => {
    expect(() => total([])).toThrow("EMPTY_CART");
    expect.fail("not implemented yet");
  });
});
