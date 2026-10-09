import { InterlockingRunner } from "@app/interlocking-runtime";

export class JourneyRunner {
  constructor(private readonly journeyYamlPath: string) {}

  execute(action: string, inputs: Record<string, unknown>, state?: unknown) {
    return new InterlockingRunner(this.journeyYamlPath).execute(action, inputs, state);
  }
}
