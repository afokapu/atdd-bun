import { TrainRunner } from "./runner";
import { runOrder } from "../orders/wagon";

class Cargo extends Map<string, unknown> {}

export class JourneyRunner {
  execute(train: { sequence: string[] }, inputs: Record<string, unknown>) {
    const cargo = new Cargo(Object.entries(inputs));
    for (const step of train.sequence) {
      runOrder(cargo);
    }
    return new TrainRunner("plan/_trains/direct.yaml").execute("train:direct:run", inputs);
  }
}
