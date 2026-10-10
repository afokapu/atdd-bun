import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../../src/trains/interlocking.ts";
import { TrainRunner } from "../../../src/trains/runner.ts";
import { testTrainContext } from "../../support/production-train.ts";

test("create_world selects the declared refuse train of interlocking:source-corpus-admission", async () => {
  const runner = new InterlockingRunner("plan/_trains/_interlockings/source-corpus-admission.yaml");
  const resolution = await runner.resolveTrain("create_world", { source: { declared: true } });
  const context = await testTrainContext(resolution.trainPath);
  const executed = await new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  expect(resolution.routeId).toBe("refuse");
  expect(resolution.trainId).toBe("train:source:refuse");
  expect(executed.selectedTrainId).toBe("train:source:refuse");
});
