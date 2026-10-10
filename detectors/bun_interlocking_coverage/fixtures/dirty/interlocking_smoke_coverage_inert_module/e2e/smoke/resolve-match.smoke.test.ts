// Phase: SMOKE
import { expect, test } from "bun:test";
import { dispatch } from "../../src/server";
import { InterlockingRunner } from "../../src/trains/interlocking";
import { TrainRunner } from "../../src/trains/runner";

test("inert runner helper does not prove functional Station Master dispatch", async () => {
  const result = await dispatch("resolve_match", { allPlayersVoted: true });
  expect(result.selectedTrainId).toBe("train:match:match-resolution-standard");
  expect(InterlockingRunner).toBeDefined();
  expect(TrainRunner).toBeDefined();
});
