// Trace-binding e2e test — asserts EVERY required binding field, tying the run to its declaration.
import { InterlockingRunner } from "../../../convex/trains/interlocking";
import { TrainRunner } from "../../../convex/trains/runner";

test("alternate-timeout trace binds the declared route", () => {
  const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
  const resolution = runner.resolveTrain("resolve_match", { timerExpired: true });
  const result: any = new TrainRunner(resolution.trainId).execute({});
  const trace = result.trace;
  expect(trace.interlockingId).toBe("interlocking:match-resolution");
  expect(trace.routeId).toBe("alternate-timeout");
  expect(trace.selectedTrainId).toBe("3207-match-resolution-timeout");
  expect(trace.routeCategory).toBe("alternate");
  expect(trace.guardId).toBe("guard:timer-expires");
  expect(trace.resolutionStrategy).toBe("fail_on_multiple_match");
  expect(trace.resolutionReason).toBeTruthy();
});
