// URN: test:orders:checkout:E020-AUTH-001-denies-anonymous
// Acceptance: acc:orders:E020-AUTH-001-denies-anonymous
// Phase: SMOKE
// Layer: integration
// Runtime: bun
import { describe, it, expect } from "bun:test";

describe("orders auth", () => {
  // @covers acc:orders:E020-AUTH-001-denies-anonymous
  it("refuses an anonymous write", async () => {
    const res = await fetch("http://localhost:3000/orders", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("FORBIDDEN");
  });
});
