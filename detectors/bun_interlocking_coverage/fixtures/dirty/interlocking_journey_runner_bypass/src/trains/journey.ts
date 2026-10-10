import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  async execute(_action: string, _context: object) {
    const inert = new InterlockingRunner("plan/_trains/_interlockings/match.yaml");
    return { selectedTrainId: "train:journey:nominal", inert };
  }
}
