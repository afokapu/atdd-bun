// URN: test:orders:checkout:E041-SMOKE-001
// Acceptance: acc:orders:E041-SMOKE-001
// Phase: SMOKE
// Layer: integration
import { describe, it, expect } from "bun:test";

describe("orders", () => {
  it("serves the orders fragment", async () => {
    const res = await fetch("http://localhost:3000/orders");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("order");
  });

  it("updates the badge out of band", async () => {
    const res = await fetch("http://localhost:3000/orders", { method: "POST" });
    const html = await res.text();
    expect(html).toContain("hx-swap-oob");
  });
});
