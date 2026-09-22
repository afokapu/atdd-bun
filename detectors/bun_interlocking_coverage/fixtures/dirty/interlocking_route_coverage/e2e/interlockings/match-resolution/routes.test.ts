// DIRTY — only the nominal route is exercised; alternate-timeout is a silent-green route-control branch.
import { InterlockingRunner } from "../../../convex/trains/interlocking";
import { TrainRunner } from "../../../convex/trains/runner";

test("nominal resolves the standard train", () => {
  const resolution = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml").resolveTrain(
    "resolve_match",
    { allPlayersVoted: true },
  );
  expect(resolution.routeId).toBe("nominal-all-voted");
  new TrainRunner(resolution.trainId).execute({});
});
