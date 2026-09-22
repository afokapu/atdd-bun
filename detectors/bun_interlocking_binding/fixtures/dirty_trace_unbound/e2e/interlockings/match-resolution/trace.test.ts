// DIRTY — trace_to_declaration. The trace assertion names a routeId that the
// interlocking YAML route space does not declare, so the executed run is not bound
// back to its declaration: it could have resolved the wrong route, category or guard
// and this test would still pass.
//
// This fixture also exists to keep the persona guard HONEST. Without a committed tree
// that trips this direction, test_coder_families_never_report_on_a_test_file_in_a_mixed_tree
// passed vacuously — it had nothing to catch, so reverting the fix it guards changed
// nothing. A guard with no input is not a guard.
// Trace-binding e2e test — asserts the captured trace binds back to the declared route.
import { dispatch } from "../../../convex/app";

test("resolve_match trace binds the declared route", () => {
  const result: any = dispatch("resolve_match", { allPlayersVoted: true });
  const trace = result.trace;
  expect(trace.interlockingId).toBe("interlocking:match-resolution");
  expect(trace.routeId).toBe("ghost-route-not-declared");
  expect(trace.selectedTrainId).toBe("3007-match-resolution-standard");
});
