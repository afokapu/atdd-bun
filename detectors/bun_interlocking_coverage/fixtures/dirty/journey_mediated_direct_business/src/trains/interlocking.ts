import { TrainRunner } from "./runner";

export class InterlockingRunner {
  constructor(private readonly interlockingPath: string) {}
  resolveTrain(_action: string, _inputs: object) {
    return { routeId: "nominal", trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" };
  }
  execute(action: string, inputs: object, context: object) {
    const resolution = this.resolveTrain(action, inputs);
    const handlers = { interlockingPath: this.interlockingPath };
    return new TrainRunner(resolution.trainPath).execute(resolution.trainId, handlers, context);
  }
}
