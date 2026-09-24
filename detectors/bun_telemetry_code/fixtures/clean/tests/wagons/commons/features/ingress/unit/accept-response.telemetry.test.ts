// URN: test:commons:ingress:E001-UNIT-001
// Acceptance: acc:commons:E001-UNIT-001
// Telemetry: telemetry:event:be:commons:response-invocation-accepted
// Telemetry: telemetry:metric:be:commons:response-invocation-accepted:duration
import { expect, mock, test } from "bun:test";
import { acceptResponse } from "../../../../../src/wagons/commons/features/ingress/domain/accept-response";

test("emits the planned event once the invocation commits", () => {
  const emit = mock(() => {});
  acceptResponse({ id: "r-1" }, { emit });
  expect(emit).toHaveBeenCalledWith("telemetry:event:be:commons:response-invocation-accepted", { response_id: "r-1", outcome: "accepted" });
  expect(emit).toHaveBeenCalledWith("telemetry:metric:be:commons:response-invocation-accepted:duration", { outcome: "accepted" });
});
