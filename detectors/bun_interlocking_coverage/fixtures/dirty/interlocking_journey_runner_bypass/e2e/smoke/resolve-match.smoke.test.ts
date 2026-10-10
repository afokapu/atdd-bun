// Phase: SMOKE
import { expect, test } from "bun:test";
import { dispatch } from "../../src/server";
import { InterlockingRunner } from "../../src/trains/interlocking";
import { TrainRunner } from "../../src/trains/runner";

test("direct business output is not a runner proof", async () => {
  const result = await dispatch("resolve_match", { allPlayersVoted: true });
  expect(result.selectedTrainId).toBe("train:journey:nominal");
  expect(InterlockingRunner).toBeDefined();
  expect(TrainRunner).toBeDefined();
});
