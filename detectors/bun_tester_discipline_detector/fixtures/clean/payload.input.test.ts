// URN: test:orders:checkout:E021-INPUT-001-rejects-malformed
// Acceptance: acc:orders:E021-INPUT-001-rejects-malformed
// Phase: UNIT
// Layer: domain
import { describe, it, expect } from "bun:test";
import { parseOrder } from "../src/parse";

describe("order payload", () => {
  // @covers acc:orders:E021-INPUT-001-rejects-malformed
  it("rejects a malformed payload", () => {
    expect(() => parseOrder({ sku: null })).toThrow("INVALID_SKU");
  });
});
