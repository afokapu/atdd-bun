export type ExecutedTrain = Readonly<{
  selectedTrainId: string;
  terminal: Readonly<{ artifact: string; value: unknown }>;
  wagons: readonly string[];
}>;
export type WagonHandlerRegistry = Readonly<Record<string, (seed: Record<string, unknown>) => unknown>>;

/** A declared wagon whose handler this deployment has not composed. */
export class UnavailableWagonError extends Error {
  readonly status = 202;
  constructor(readonly trainId: string, readonly wagon: string) {
    super(`wagon ${wagon} of ${trainId} is unavailable`);
  }
}

export class TrainRunner {
  constructor(private readonly trainPath: string, private readonly handlers: WagonHandlerRegistry) {}
  async execute(resolution: Readonly<{ trainId: string }>, seed: Record<string, unknown>): Promise<ExecutedTrain> {
    const wagon = this.trainPath.replace(/^plan\/_trains\/|\.yaml$/g, "");
    const handler = this.handlers[wagon];
    if (!handler) throw new UnavailableWagonError(resolution.trainId, wagon);
    return Object.freeze({
      selectedTrainId: resolution.trainId,
      terminal: Object.freeze({ artifact: `${wagon}:result`, value: handler(seed) }),
      wagons: Object.freeze([wagon]),
    });
  }
}
