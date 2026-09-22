// URN: test:orders:checkout:E026-AUTH-001
// Acceptance: acc:orders:E026-AUTH-001
// Phase: UNIT
// Layer: integration
import { it, expect } from "bun:test";
it("lets a signed-in user through", async () => {
  const order = await place({ user: "u1" });
  expect(order.id).toBe("o1");
});
