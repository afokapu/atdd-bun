export class TrainRunner {
  constructor(private readonly trainPath: string, private readonly handlers: object = {}) {}
  execute(resolution: { trainId: string }, seed: object) {
    return { selectedTrainId: resolution.trainId, trainPath: this.trainPath, handlers: this.handlers, seed };
  }
}
