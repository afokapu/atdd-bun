// CLEAN fixture — the Station Master reached as a MODULE, not a class.
//
// The smoke check used to demand a symbol literally named StationMaster. The coder
// rule defines the Station Master as the entrypoint file carrying a JOURNEY_MAP —
// structure, not nomenclature — so a consumer with a module-level dispatch passed
// the coder rule and failed this one. This tree is that consumer; it must be silent.
// Station Master smoke test for the exposed resolve_match action — drives the real entrypoint ->
// Station Master -> InterlockingRunner -> TrainRunner path.
import * as server from "./server";
import { InterlockingRunner } from "../../convex/trains/interlocking";
import { TrainRunner } from "../../convex/trains/runner";

test("resolve_match smoke reaches the Station Master", () => {
  // entrypoint reached as a module, not a class
  const result: any = server.handleAction("resolve_match", { allPlayersVoted: true });
  expect(server.interlockingRunner).toBeInstanceOf(InterlockingRunner);
  expect(server.trainRunner).toBeInstanceOf(TrainRunner);
  expect(result.selectedTrainId).toBe("3007-match-resolution-standard");
});
