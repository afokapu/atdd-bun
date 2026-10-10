// Phase: SMOKE
import { expect, test } from "bun:test";
import { dispatch } from "../../src/server";
import { InterlockingRunner } from "../../src/trains/interlocking";
import { TrainRunner } from "../../src/trains/runner";

test("resolve_match target token cannot cover resolve_other dispatch", async () => {
  const result = await dispatch("resolve_other", { allPlayersVoted: true });
  expect(result.selectedTrainId).toBe("train:match:match-resolution-standard");
  expect(InterlockingRunner).toBeDefined();
  expect(TrainRunner).toBeDefined();
});
