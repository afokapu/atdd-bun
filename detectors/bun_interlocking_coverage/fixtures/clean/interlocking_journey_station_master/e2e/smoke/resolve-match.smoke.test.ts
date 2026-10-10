// Phase: SMOKE
import { expect, test } from "bun:test";
import { dispatch } from "../../src/server";
import { InterlockingRunner } from "../../src/trains/interlocking";
import { TrainRunner } from "../../src/trains/runner";

test("JourneyRunner Station Master smoke", async () => {
  const result = await dispatch("resolve_match", { allPlayersVoted: true });
  expect(result.selectedTrainId).toBe("train:journey:nominal");
  expect(InterlockingRunner).toBeDefined();
  expect(TrainRunner).toBeDefined();
});
