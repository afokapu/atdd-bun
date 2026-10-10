import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  constructor(private readonly journeyPath: string) {}

  async execute(action: string, context: object) {
    return await new InterlockingRunner(this.journeyPath).execute(action, context);
  }
}
