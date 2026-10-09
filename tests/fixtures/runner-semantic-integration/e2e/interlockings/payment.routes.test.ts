import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../src/trains/interlocking";
import { TrainRunner } from "../../src/trains/runner";
test("payment resolution executes the declared terminal train", () => {
  const resolution = new InterlockingRunner("plan/_trains/_interlockings/payment.yaml").resolveTrain("checkout", {});
  const result = new TrainRunner(resolution.trainId).execute({});
  expect(resolution.routeId).toBe("paid");
  expect(resolution.trainId).toBe("train:checkout:complete");
  expect(result.steps).toEqual([{ to: "buyer" }]);
  expect(result.steps).toContainEqual(expect.objectContaining({ to: "buyer" }));
  expect(result.steps.at(-1)).toEqual(expect.objectContaining({ to: "buyer" }));
});
