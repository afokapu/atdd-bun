// TrainRunner — CLEAN fixture. The production linear train executor: the ONLY component that runs
// wagons and carries Cargo between them. Legitimate execution; not scanned by the interlocking
// detector (only InterlockingRunner-defining modules are scanned for direct wagon execution).
import { runMatch } from "../match/wagon";

export class Cargo extends Map<string, unknown> {}

export class TrainRunner {
  constructor(private readonly trainPath: string) {}

  execute(trainId: string, inputs: Record<string, unknown>) {
    let cargo: Cargo = new Cargo(Object.entries(inputs));
    const train = loadTrain(this.trainPath);
    for (const step of train.sequence) {
      cargo = runTrain(step, cargo);
    }
    return { selectedTrainId: trainId, artifacts: Object.fromEntries(cargo) };
  }
}

function runTrain(step: string, cargo: Cargo): Cargo {
  if (step === "match") return runMatch(cargo) as Cargo;
  return cargo;
}

function loadTrain(_path: string) {
  return { sequence: ["match"] };
}
