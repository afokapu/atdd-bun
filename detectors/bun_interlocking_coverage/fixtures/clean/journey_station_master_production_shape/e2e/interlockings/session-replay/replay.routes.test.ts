import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../../src/trains/interlocking.ts";
import { TrainRunner } from "../../../src/trains/runner.ts";
import { testTrainContext } from "../../support/production-train.ts";

test("replay_session selects the declared replay train of interlocking:session-replay", async () => {
  const runner = new InterlockingRunner("plan/_trains/_interlockings/session-replay.yaml");
  const resolution = await runner.resolveTrain("replay_session", { replay: { declared: true } });
  const context = await testTrainContext(resolution.trainPath);
  const executed = await new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  expect(resolution.routeId).toBe("replay");
  expect(resolution.trainId).toBe("train:session:replay");
  expect(executed.selectedTrainId).toBe("train:session:replay");
});
