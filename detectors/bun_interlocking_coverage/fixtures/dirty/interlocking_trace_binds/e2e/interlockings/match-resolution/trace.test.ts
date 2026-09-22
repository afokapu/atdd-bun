// DIRTY — the trace assertion checks only selected_train_id; it omits routeId/routeCategory/
// routeCategoryDigit/guardId/resolutionStrategy/resolutionReason/interlockingId, so the run could
// resolve the wrong route/category/guard and still pass.
import { InterlockingRunner } from "../../../convex/trains/interlocking";
import { TrainRunner } from "../../../convex/trains/runner";

test("trace only checks the selected train", () => {
  const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
  const resolution = runner.resolveTrain("resolve_match", { timerExpired: true });
  const result: any = new TrainRunner(resolution.trainId).execute({});
  const trace = result.trace;
  expect(trace.selectedTrainId).toBe("3207-match-resolution-timeout");
});
