// DIRTY fixture — coder.bun.interlocking-does-not-carry-cargo.
// The InterlockingRunner module references the Cargo data plane and stores an artifact_urn value,
// bleeding the artifact plane into the route-control layer.
// Expected: >=1 violation (interlocking-cargo-mutation).
import { TrainRunner } from "./runner";
import { Cargo } from "./runner";

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
    // BUG: the interlocking reads/mutates Cargo and stores an artifact_urn value mid-resolution.
    const cargo = new Cargo();
    cargo["artifact_urn"] = "urn:artifact:match:result";
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
    return new TrainRunner(resolution.trainPath).execute(resolution.trainId, inputs);
  }
}
