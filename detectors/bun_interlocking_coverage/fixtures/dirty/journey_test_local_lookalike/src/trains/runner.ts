export class TrainRunner {
  constructor(private readonly trainPath: string) {}
  execute(trainId: string, handlers: object, context: object) {
    return { selectedTrainId: trainId, trainPath: this.trainPath, handlers, context };
  }
}
