// URN: test:commons:ingress:E001-UNIT-001
// Acceptance: acc:commons:E001-UNIT-001
// Telemetry: telemetry:event:be:commons:response-invocation-accepted
import { expect, test } from "bun:test";
import { acceptResponse } from "../../../../../src/wagons/commons/features/ingress/domain/accept-response";

test("accepts the response", () => {
  const done: string[] = [];
  acceptResponse({ id: "r-1" }, { emit: (id) => done.push(id) });
  expect(done.length).toBeGreaterThan(0);
});
