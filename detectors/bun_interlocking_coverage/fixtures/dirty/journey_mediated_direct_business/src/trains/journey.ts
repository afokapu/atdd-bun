import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  constructor(private readonly journeyPath: string) {}
  execute(action: string, inputs: object, context: { handlers: object; seed: object }) {
    return new InterlockingRunner(this.journeyPath).execute(action, inputs, context);
  }
}
