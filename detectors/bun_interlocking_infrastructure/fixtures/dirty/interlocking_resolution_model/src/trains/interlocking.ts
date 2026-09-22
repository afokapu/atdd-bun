// DIRTY fixture — coder.bun.interlocking-resolution-model-exists.
// resolveTrain resolves a BARE trainId string; there is no structured InterlockingResolution model
// carrying routeId/guardId/category/... Expected: >=1 violation (bare-train-id-resolution).
import { TrainRunner } from "./runner";

export class InterlockingRunner {
  private readonly path: string;
  constructor(interlockingYamlPath: string) {
    this.path = interlockingYamlPath;
  }

  // BUG: returns a bare trainId string — loses routeId, guardId, category, resolutionStrategy, reason, ...
  resolveTrain(action: string, inputs: Record<string, unknown>): string {
    return "3001-solo-match-complete";
  }

  execute(action: string, inputs: Record<string, unknown>) {
    const trainId = this.resolveTrain(action, inputs);
    return new TrainRunner(`plan/_trains/${trainId}.yaml`).execute(trainId, inputs);
  }
}
