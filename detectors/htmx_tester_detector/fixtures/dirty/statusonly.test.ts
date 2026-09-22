// URN: test:orders:checkout:E011-UNIT-001
// Acceptance: acc:orders:E011-UNIT-001
// Phase: UNIT
// Layer: integration
import { it, expect } from "bun:test";
it("serves the fragment", async () => {
  const res = await fetch("http://localhost:3000/orders/1");
  expect(res.status).toBe(200);
});
