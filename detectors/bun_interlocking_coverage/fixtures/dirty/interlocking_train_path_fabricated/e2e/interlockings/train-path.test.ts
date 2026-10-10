import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../../src/interlocking";
import { TrainRunner } from "../../../src/runner";

test("a fabricated path cannot pass as a resolution", async () => {
  const context = { handlers: {}, seed: {} };
  const resolution = new InterlockingRunner("plan/_trains/_interlockings/path.yaml").resolveTrain("resolve_path", context);
  const execution = await new TrainRunner("plan/_trains/fabricated.yaml", context.handlers).execute(resolution, context.seed);
  expect(resolution.selectedTrainId).toBe("train:path:nominal");
  expect(execution).toBeDefined();
});
