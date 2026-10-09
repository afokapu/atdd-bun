import { readFileSync } from "node:fs";
import { Cargo, runOrder, runReceipt } from "../orders/wagons";

function executeWagon(step: string, result: Record<string, unknown>): Record<string, unknown> {
  const cargo = new Cargo();
  if (step === "order") runOrder(cargo);
  if (step === "receipt") runReceipt(cargo);
  return { ...result, [step]: "executed" };
}

function parseTrain(path: string): { sequence: string[] } {
  const text = readFileSync(path, "utf8");
  return { sequence: [...text.matchAll(/^\s*-\s*to:\s*wagon:([^\s]+)$/gm)].map(match => match[1]) };
}

export class TrainRunner {
  constructor(private readonly trainDeclarationPath: string, private readonly trainId?: string) {}
  execute(inputs: Record<string, unknown>) {
    const train = parseTrain(this.trainDeclarationPath);
    let result: Record<string, unknown> = inputs;
    for (const step of train.sequence) {
      result = executeWagon(step, result);
    }
    return { selectedTrainId: this.trainId, result, steps: train.sequence.map(to => ({ to })) };
  }
}
