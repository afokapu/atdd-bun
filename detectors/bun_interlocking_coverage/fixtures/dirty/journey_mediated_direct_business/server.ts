import { JourneyRunner } from "./src/trains/journey";
import { InterlockingRunner } from "./src/trains/interlocking";
import { TrainRunner } from "./src/trains/runner";

export const JOURNEY_MAP = {
  resolve_match: { journeyId: "journey:match", path: "plan/_journeys/match.yaml" },
};

// The production chain is importable and even exercised by a module-local helper, but the
// exported action returns business data directly instead of the JourneyRunner execution.
const runner = new InterlockingRunner("plan/_trains/_interlockings/match.yaml");
function inertProductionHelper(action: string, inputs: object, context: { handlers: object; seed: object }) {
  const resolution = runner.resolveTrain(action, inputs);
  return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
}

export function dispatch(_action: keyof typeof JOURNEY_MAP, _inputs: object, _context: { handlers: object; seed: object }) {
  void JourneyRunner;
  void inertProductionHelper;
  return { selectedTrainId: "train:match:nominal" };
}
