// URN: test:commons:ingress:E001-UNIT-001
// Acceptance: acc:commons:E001-UNIT-001
// Telemetry: telemetry:event:be:commons:unknown-item
import { expect, mock, test } from "bun:test";

test("proves nothing yet", () => {
  const emit = mock(() => {});
  expect(emit).not.toHaveBeenCalled();
});
