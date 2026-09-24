// URN: test:commons:ingress:E002-UNIT-001
// Acceptance: acc:commons:E002-UNIT-001
import { expect, test } from "bun:test";

test("a plain non-telemetry test is not judged by the telemetry rules", () => {
  expect(1 + 1).toBe(2);
});
