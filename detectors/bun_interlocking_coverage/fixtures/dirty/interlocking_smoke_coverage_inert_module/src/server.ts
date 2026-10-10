import { InterlockingRunner } from "./trains/interlocking";
import { TrainRunner } from "./trains/runner";

const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");

async function inertProductionHelper(action: string, inputs: object) {
  const resolution = runner.resolveTrain(action, inputs);
  return await new TrainRunner(resolution.trainId).execute({});
}

export async function dispatch(_action: string, _inputs: object) {
  return { selectedTrainId: "train:match:match-resolution-standard" };
}
