import { InterlockingRunner } from "@app/interlocking-runtime";

export class JourneyRunner {
  execute(action: string, inputs: Record<string, unknown>, state?: unknown) {
    const runner = new InterlockingRunner("plan/_trains/_interlockings/first.yaml");
    return runner.execute(action, inputs, state);
  }
}
