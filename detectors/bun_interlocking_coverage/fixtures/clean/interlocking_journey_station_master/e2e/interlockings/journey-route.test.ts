import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../src/trains/interlocking";
import { TrainRunner } from "../../src/trains/runner";

test("journey route is resolved through the selected train", async () => {
  const resolution = new InterlockingRunner("plan/_trains/_interlockings/match.yaml").resolveTrain("resolve_match", {});
  const execution = await new TrainRunner(resolution.trainId).execute({});
  expect(resolution.selectedTrainId).toBe("train:journey:nominal");
  expect(execution).toBeDefined();
});
