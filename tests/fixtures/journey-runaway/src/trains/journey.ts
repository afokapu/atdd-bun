import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  execute(action: string, inputs: Record<string, unknown>, state?: unknown) {
    // Looks layered, but it ignores plan/_journeys completely and invents topology in code.
    const next = new InterlockingRunner("plan/_trains/_interlockings/rogue.yaml");
    return next.execute(action, inputs, state);
  }
}
