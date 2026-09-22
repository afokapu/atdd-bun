// URN: test:orders:checkout:E001-SMOKE-001-renders-row
// Acceptance: acc:orders:E001-SMOKE-001-renders-row
// WMBT: wmbt:orders:E001
// Phase: SMOKE
// Layer: integration
import { describe, it, expect } from "bun:test";

describe("orders fragment", () => {
  // @covers acc:orders:E001-SMOKE-001-renders-row
  it("returns a swappable row carrying its id", async () => {
    const res = await fetch("http://localhost:3000/orders/1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="order-1"');
  });
});
