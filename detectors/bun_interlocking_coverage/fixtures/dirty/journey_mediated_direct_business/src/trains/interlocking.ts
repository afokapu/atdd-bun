import { TrainRunner } from "./runner";

export class InterlockingRunner {
  constructor(private readonly interlockingPath: string) {}
  resolveTrain(_action: string, _inputs: object) {
    return { routeId: "nominal", trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" };
  }
  execute(action: string, inputs: object, context: { handlers: object; seed: object }) {
    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  }
}
