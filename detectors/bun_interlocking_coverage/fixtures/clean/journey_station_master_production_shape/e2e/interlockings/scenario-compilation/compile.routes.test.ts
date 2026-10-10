import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../../src/trains/interlocking.ts";
import { TrainRunner } from "../../../src/trains/runner.ts";
import { testTrainContext } from "../../support/production-train.ts";

test("create_scenario selects the declared compile train of interlocking:scenario-compilation", async () => {
  const runner = new InterlockingRunner("plan/_trains/_interlockings/scenario-compilation.yaml");
  const resolution = await runner.resolveTrain("create_scenario", { scenario: { declared: true } });
  const context = await testTrainContext(resolution.trainPath);
  const executed = await new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  expect(resolution.routeId).toBe("compile");
  expect(resolution.trainId).toBe("train:scenario:compile");
  expect(executed.selectedTrainId).toBe("train:scenario:compile");
});
