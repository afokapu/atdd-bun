// URN: test:orders:checkout:E008-SMOKE-001
// Acceptance: acc:orders:E008-SMOKE-001
// Phase: SMOKE
// Layer: integration
import { it, expect, mock, spyOn } from "bun:test";
import * as repo from "../src/repo";
it("saves the order", async () => {
  spyOn(repo, "save");
  const res = await fetch("http://localhost:3000/orders");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("saved");
});
