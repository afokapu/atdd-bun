// InterlockingRunner route-control layer — CLEAN fixture (Bun/TS).
// Resolves exactly one admissible train into a structured InterlockingResolution and delegates
// linear execution to TrainRunner. It never imports a wagon, calls runTrain, loops over
// train.sequence, or touches Cargo (core afokapu/atdd#1251).
import { TrainRunner } from "./runner";

export interface InterlockingResolution {
  interlockingId: string;
  routeId: string;
  trainId: string;
  trainPath: string;
  category: string;
  resolutionStrategy: string;
  guardId: string;
  reason: string;
}

export class InterlockingRunner {
  private readonly path: string;
  constructor(interlockingYamlPath: string) {
    this.path = interlockingYamlPath;
  }

  resolveTrain(action: string, inputs: Record<string, unknown>, state?: unknown): InterlockingResolution {
    return {
      interlockingId: "interlocking:match-resolution",
      routeId: "nominal-all-voted",
      trainId: "3001-solo-match-complete",
      trainPath: "plan/_trains/3001-solo-match-complete.yaml",
      category: "nominal",
      resolutionStrategy: "first_priority",
      guardId: "all-voted",
      reason: "all participants voted",
    };
  }

  execute(action: string, inputs: Record<string, unknown>, state?: unknown) {
    const resolution = this.resolveTrain(action, inputs, state);
    return new TrainRunner(resolution.trainPath).execute(resolution.trainId, inputs);
  }
}
