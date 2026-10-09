import { Cargo, runWagon } from "../orders/wagon";

export function runTrain(step: string, cargo: Cargo): void {
  if (step === "confirm-order") runWagon(cargo);
}
