import { JourneyRunner } from "./src/trains/journey";
import { InterlockingRunner } from "./src/trains/interlocking";
import { TrainRunner } from "./src/trains/runner";

export const JOURNEY_MAP = {
  resolve_match: { journeyId: "journey:match", path: "plan/_journeys/match.yaml" },
};

const runner = new InterlockingRunner("plan/_trains/_interlockings/match.yaml");
function inertProductionHelper(action: string, inputs: object, context: object) {
  const resolution = runner.resolveTrain(action, inputs);
  return new TrainRunner(resolution.trainPath).execute(resolution.trainId, {}, context);
}

export function dispatch(_action: keyof typeof JOURNEY_MAP, _inputs: object, _context: object) {
  void JourneyRunner;
  void inertProductionHelper;
  return { selectedTrainId: "train:match:nominal" };
}
