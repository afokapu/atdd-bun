// Phase: SMOKE
import { expect, test } from "bun:test";
import {
  executeAction,
  JOURNEY_MAP,
  stationMaster,
} from "../../src/server.ts";
import { InterlockingRunner } from "../../src/trains/interlocking.ts";
import { TrainRunner } from "../../src/trains/runner.ts";
import { testTrainContext } from "../support/production-train.ts";

const proveProductionRoute = async (path: string, action: string, inputs: Record<string, unknown>) => {
  const runner = new InterlockingRunner(path);
  const resolution = await runner.resolveTrain(action, inputs);
  const context = await testTrainContext(resolution.trainPath);
  const executed = await new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  expect(resolution.trainId).toBeDefined();
  expect(executed).toBeDefined();
};

test("Station Master returns an incomplete Scenario continuation", async () => {
  await proveProductionRoute("plan/_trains/_interlockings/scenario-compilation.yaml", "create_scenario", { scenario: { valid: true } });
  const result = await executeAction("create_scenario", { scenario: { valid: true } });
  expect(result).toMatchObject({ disposition: "INCOMPLETE_CONTINUATION", status: 202 });
  expect(JOURNEY_MAP.create_scenario.interlockingId).toBe("interlocking:scenario-compilation");
  expect(InterlockingRunner).toBeDefined();
  expect(TrainRunner).toBeDefined();
});

test("Station Master executes the bounded source refusal terminal", async () => {
  await proveProductionRoute("plan/_trains/_interlockings/source-corpus-admission.yaml", "create_world", { source: { required_supported: false } });
  const response = await stationMaster({ submission: { id: "smoke" }, supported: false });
  expect(response.status).toBe(422);
  expect(response.headers.get("x-journey-disposition")).toBe("TERMINAL");
  expect(await response.text()).toContain("UNSUPPORTED_SOURCE_FORMAT");
});
