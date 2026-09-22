// DIRTY fixture — coder.bun.interlocking-delegates-to-trainrunner.
// The InterlockingRunner module imports a wagon directly, calls runTrain(...), and loops over
// train.sequence as a step executor — competing with TrainRunner instead of delegating.
// Expected: >=1 violation (interlocking-direct-wagon-execution).
import { runMatch } from "../match/wagon";

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
  constructor(private readonly path: string) {}

  resolveTrain(action: string, inputs: Record<string, unknown>): InterlockingResolution {
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

  execute(action: string, inputs: Record<string, unknown>) {
    const resolution = this.resolveTrain(action, inputs);
    const train = { sequence: ["match"] };
    let acc: Record<string, unknown> = inputs;
    // BUG: interlocking duplicates the TrainRunner step loop and executes wagons itself.
    for (const step of train.sequence) {
      acc = runTrain(step, acc);
    }
    return { selectedTrainId: resolution.trainId, artifacts: acc };
  }
}

function runTrain(step: string, acc: Record<string, unknown>): Record<string, unknown> {
  if (step === "match") return runMatch(new Map()) as unknown as Record<string, unknown>;
  return acc;
}
