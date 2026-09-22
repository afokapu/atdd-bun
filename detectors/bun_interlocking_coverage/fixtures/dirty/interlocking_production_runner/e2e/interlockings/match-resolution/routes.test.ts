// DIRTY — the route test drives a MockInterlockingRunner instead of the production runner: a
// descriptive green that proves nothing about production route control.
import { MockInterlockingRunner } from "../../../test/mocks";

test("nominal resolves the standard train (against a fake)", () => {
  const resolution = new MockInterlockingRunner().resolveTrain("resolve_match", { allPlayersVoted: true });
  expect(resolution.routeId).toBe("nominal-all-voted");
  expect(resolution.trainId).toBe("3007-match-resolution-standard");
});

// SECOND substitution, and the one that matters most on THIS stack: bun:test's
// mock.module() swaps the entire InterlockingRunner module. Before the Bun idioms were
// added to FORBIDDEN_PATTERNS this file's mock.module()/spyOn() were invisible — the
// list arrived from the Convex mirror carrying only vi./jest.-prefixed patterns, so a
// test could replace the whole route-control layer and report clean. The precision row
// for this rule pins "mock.module" so that regression cannot return quietly.
mock.module("../../../src/trains/interlocking", () => ({
  InterlockingRunner: class {
    resolveTrain() {
      return { routeId: "nominal-all-voted", trainId: "3007-match-resolution-standard" };
    }
  },
}));
