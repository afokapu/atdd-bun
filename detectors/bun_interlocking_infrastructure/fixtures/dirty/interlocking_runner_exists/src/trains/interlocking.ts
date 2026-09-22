// DIRTY fixture — coder.bun.interlocking-runner-exists.
// The InterlockingRunner class exists but ships NO resolveTrain(...) entry point, so a consumer
// declaring interlocking routes has no route-control entry. Expected: >=1 violation (missing-resolve-train).
import { TrainRunner } from "./runner";

export class InterlockingRunner {
  private readonly path: string;
  constructor(interlockingYamlPath: string) {
    this.path = interlockingYamlPath;
  }

  // BUG: no resolveTrain(...) — there is no route-control entry point at all.
  execute(action: string, inputs: Record<string, unknown>) {
    return new TrainRunner("plan/_trains/3001-solo-match-complete.yaml").execute("3001-solo-match-complete", inputs);
  }
}
