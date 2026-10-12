// Phase: E2E
// Consumer journey shape (DOS Play e2e/journeys, read only): the test drives the declared journey through the
// production JourneyRunner, which composes InterlockingRunner -> TrainRunner, and asserts its result.
import { expect, test } from "bun:test";
import { JourneyRunner } from "../../src/trains/journey.ts";
import { testTrainContext } from "../support/production-train.ts";

test("create_world reaches the declared source refusal terminal through the production JourneyRunner", async () => {
  const journey = new JourneyRunner("plan/_journeys/create-world-pack.yaml");
  const context = await testTrainContext("plan/_trains/train:source:refuse.yaml");
  const result = await journey.execute("create_world", { source: { required_supported: false } }, {
    initialArtifacts: context.seed,
    handlers: context.handlers,
  });
  expect(result).toMatchObject({
    selectedTrainId: "train:source:refuse",
    journey: { outcome: "unsupported source refused", interlockings: ["interlocking:source-corpus-admission"] },
  });
});
