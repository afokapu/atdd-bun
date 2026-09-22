// Station Master smoke test for the exposed resolve_match action — drives the real entrypoint ->
// Station Master -> InterlockingRunner -> TrainRunner path.
import { StationMaster } from "../../convex/app";
import { InterlockingRunner } from "../../convex/trains/interlocking";
import { TrainRunner } from "../../convex/trains/runner";

test("resolve_match smoke reaches the Station Master", () => {
  const stationMaster = new StationMaster();
  const result: any = stationMaster.handleAction("resolve_match", { allPlayersVoted: true });
  expect(stationMaster.interlockingRunner).toBeInstanceOf(InterlockingRunner);
  expect(stationMaster.trainRunner).toBeInstanceOf(TrainRunner);
  expect(result.selectedTrainId).toBe("3007-match-resolution-standard");
});
