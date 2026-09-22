// URN: test:orders:checkout:E022-TELEMETRY-001-emits-placed
// Acceptance: acc:orders:E022-TELEMETRY-001-emits-placed
// Phase: UNIT
// Layer: application
import { describe, it, expect, mock } from "bun:test";
import { placeOrder } from "../src/place";

describe("order telemetry", () => {
  // @covers acc:orders:E022-TELEMETRY-001-emits-placed
  it("emits order_placed", () => {
    const emit = mock(() => {});
    placeOrder({ sku: "x" }, { emit });
    expect(emit).toHaveBeenCalledWith("order_placed", { sku: "x" });
  });
});
