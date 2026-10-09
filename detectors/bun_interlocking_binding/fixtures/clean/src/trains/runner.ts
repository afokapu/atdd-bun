// TrainRunner — reads the selected train declaration and executes its declared wagons in order.
import { readFileSync } from "node:fs";

type Result = Record<string, unknown>;

function parseTrain(path: string): { sequence: string[] } {
  const text = readFileSync(path, "utf8");
  return { sequence: [...text.matchAll(/^\s*-\s*([^#\s]+)\s*$/gm)].map((match) => match[1]) };
}

function executeWagon(wagon: string, result: Result): Result {
  return { ...result, [wagon]: "executed" };
}

export class TrainRunner {
  constructor(private readonly trainDeclarationPath: string, private readonly trainId?: string) {}
  execute(inputs: Record<string, unknown>) {
    const train = parseTrain(this.trainDeclarationPath);
    let result: Result = inputs;
    for (const wagon of train.sequence) {
      result = executeWagon(wagon, result);
    }
    return { selectedTrainId: this.trainId, result };
  }
}
