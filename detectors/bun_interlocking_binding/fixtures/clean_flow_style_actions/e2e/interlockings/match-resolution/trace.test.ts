// Trace-binding e2e test — asserts the captured trace binds back to the declared route.
import { dispatch } from "../../../convex/app";

test("resolve_match trace binds the declared route", () => {
  const result: any = dispatch("resolve_match", { allPlayersVoted: true });
  const trace = result.trace;
  expect(trace.interlockingId).toBe("interlocking:match-resolution");
  expect(trace.routeId).toBe("nominal-all-voted");
  expect(trace.selectedTrainId).toBe("3007-match-resolution-standard");
});
