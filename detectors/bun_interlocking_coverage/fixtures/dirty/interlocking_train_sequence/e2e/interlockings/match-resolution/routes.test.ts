// Asserts WHICH train each route selects — and nothing about the ORDER it executes.
// That is the gap: reorder either train's wagons and every assertion here still holds.
import { test, expect } from "bun:test";
import { InterlockingRunner } from "../../../src/trains/interlocking";

const IL = "plan/_trains/_interlockings/match-resolution.yaml";

test("nominal route selects the standard train", () => {
  const r = new InterlockingRunner(IL).resolveTrain("resolve_match", {}, {});
  expect(r.trainId).toBe("3007-match-resolution-standard");
});

test("alternate route selects the timeout train", () => {
  const r = new InterlockingRunner(IL).resolveTrain("resolve_match", {}, { voteWindowExpired: true });
  expect(r.trainId).toBe("3207-match-resolution-timeout");
});
