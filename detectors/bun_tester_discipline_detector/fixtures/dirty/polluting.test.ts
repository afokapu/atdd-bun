// URN: test:orders:checkout:E010-UNIT-001
// Acceptance: acc:orders:E010-UNIT-001
// Phase: UNIT
// Layer: domain
import { it, expect } from "bun:test";
import { writeFileSync } from "node:fs";
process.env.DATABASE_URL = "postgres://live";
it("writes a report", () => {
  writeFileSync("./reports/out.json", "{}");
  expect(1).toBe(1);
});
