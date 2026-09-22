// TrainRunner — the production linear executor the InterlockingRunner delegates to.
export class TrainRunner {
  constructor(private readonly trainId: string) {}
  execute(inputs: Record<string, unknown>) {
    return { selectedTrainId: this.trainId, inputs };
  }
}
