// End-to-end route coverage — exercises EVERY admissible route through the production runners.
import { InterlockingRunner } from "../../../convex/trains/interlocking";
import { TrainRunner } from "../../../convex/trains/runner";

function runner() {
  return new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");
}

test("nominal-all-voted resolves the standard train", () => {
  const resolution = runner().resolveTrain("resolve_match", { allPlayersVoted: true });
  expect(resolution.routeId).toBe("nominal-all-voted");
  expect(resolution.trainId).toBe("3007-match-resolution-standard");
  new TrainRunner(resolution.trainId).execute({});
});

test("alternate-timeout resolves the timeout train", () => {
  const resolution = runner().resolveTrain("resolve_match", { timerExpired: true });
  expect(resolution.routeId).toBe("alternate-timeout");
  expect(resolution.trainId).toBe("3207-match-resolution-timeout");
  new TrainRunner(resolution.trainId).execute({});
});
