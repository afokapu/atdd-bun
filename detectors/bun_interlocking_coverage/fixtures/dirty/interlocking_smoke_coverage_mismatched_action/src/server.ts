import { InterlockingRunner } from "./trains/interlocking";
import { TrainRunner } from "./trains/runner";

const runner = new InterlockingRunner("plan/_trains/_interlockings/match-resolution.yaml");

export async function dispatch(action: string, inputs: object) {
  const resolution = runner.resolveTrain(action, inputs);
  return await new TrainRunner(resolution.trainId).execute({});
}
