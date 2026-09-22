// URN: test:orders:checkout:E040-SMOKE-001-panel
// Acceptance: acc:orders:E040-SMOKE-001-panel
// Phase: SMOKE
// Layer: integration
import { describe, it, expect } from "bun:test";

describe("orders", () => {
  // @covers acc:orders:E040-SMOKE-001-panel
  it("serves the orders fragment with a swappable id", async () => {
    const res = await fetch("http://localhost:3000/orders");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="order-1"');
  });

  // @covers acc:orders:E040-SMOKE-002-oob
  it("updates the cart badge out of band", async () => {
    const res = await fetch("http://localhost:3000/orders", { method: "POST" });
    const html = await res.text();
    expect(html).toContain("hx-swap-oob");
    expect(html).toContain('id="cart-count"');
  });
});
