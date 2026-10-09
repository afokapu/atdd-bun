import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../src/trains/interlocking";
import { TrainRunner } from "../../src/trains/runner";
test("cart resolution executes the declared multi-step train", () => {
  const resolution = new InterlockingRunner("plan/_trains/_interlockings/cart.yaml").resolveTrain("checkout", {});
  const result = new TrainRunner(resolution.trainId).execute({});
  expect(resolution.routeId).toBe("ready");
  expect(resolution.trainId).toBe("train:checkout:prepare");
  expect(result.steps).toEqual([{ to: "order" }, { to: "receipt" }]);
  expect(result.steps).toContainEqual(expect.objectContaining({ to: "receipt" }));
  expect(result.steps.at(-1)).toEqual(expect.objectContaining({ to: "receipt" }));
});
