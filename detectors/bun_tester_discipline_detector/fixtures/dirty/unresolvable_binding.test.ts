// URN: test:orders:checkout:E999-SMOKE-001-phantom
// Acceptance: acc:orders:E999-NEVER-DECLARED
// WMBT: wmbt:orders:E999
// Phase: SMOKE
// Layer: integration
//
// BUG: both bindings name artifacts the plan never declares. The sibling rule
// tester.bun.acceptance-binding-declared is satisfied — the headers are PRESENT —
// so before tester.bun.acceptance-resolves-to-declared nothing attributed this
// suite to anything real.
import { test, expect } from "bun:test";

test("returns a swappable row carrying its id", async () => {
  const response = new Response('<li id="order-1">confirmed</li>', { status: 200 });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('id="order-1"');
});
