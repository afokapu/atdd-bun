import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../../src/interlocking";
import { TrainRunner } from "../../../src/runner";

test("declared trainPath drives the selected runner", async () => {
  const context = { handlers: {}, seed: { actor: "user:actor" } };
  const resolution = new InterlockingRunner("plan/_trains/_interlockings/path.yaml").resolveTrain("resolve_path", context);
  const execution = await new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  expect(resolution.selectedTrainId).toBe("train:path:nominal");
  expect(execution.steps).toEqual([{ from: "user:actor", to: "wagon:last" }]);
  expect(execution.steps).toContainEqual(expect.objectContaining({ to: "wagon:last" }));
  expect(execution.steps.at(-1)).toEqual(expect.objectContaining({ to: "wagon:last" }));
});
