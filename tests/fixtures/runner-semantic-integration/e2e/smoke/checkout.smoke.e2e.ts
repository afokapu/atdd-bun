// Phase: SMOKE
import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../src/trains/interlocking";
import { TrainRunner } from "../../src/trains/runner";
class StationMaster {
  interlockingRunner = new InterlockingRunner("plan/_trains/_interlockings/cart.yaml");
  trainRunner = new TrainRunner("plan/_trains/train:checkout:prepare.yaml");
  handleAction(action: string, inputs: Record<string, unknown>) { return this.interlockingRunner.resolveTrain(action, inputs); }
}
test("checkout reaches Station Master", () => {
  const stationMaster = new StationMaster();
  const result = stationMaster.handleAction("checkout", {});
  expect(stationMaster.interlockingRunner).toBeInstanceOf(InterlockingRunner);
  expect(stationMaster.trainRunner).toBeInstanceOf(TrainRunner);
  expect(result.routeId).toBe("ready");
});
