import { readFileSync } from "node:fs";
import { InterlockingRunner } from "./interlocking.ts";
import type { ExecutedTrain, WagonHandlerRegistry } from "./runner.ts";

type Transition = Readonly<{
  from: Readonly<{ interlocking_id: string; route_id: string }>;
  to?: Readonly<{ interlocking_id: string }>;
  artifact?: string;
  outcome?: string;
}>;
type JourneyDeclaration = Readonly<{
  entrypoint: Readonly<{ interlocking_id: string; actions: readonly string[] }>;
  continuations: readonly Transition[];
  terminals: readonly Transition[];
}>;
type ExecutionContext = Readonly<{
  initialArtifacts: Record<string, unknown>;
  handlers: WagonHandlerRegistry;
  continueOnContinuation?: boolean;
}>;
export type JourneyExecution = ExecutedTrain & Readonly<{ journey: Readonly<Record<string, unknown>> }>;

const pathFor = (interlockingId: string) =>
  `plan/_trains/_interlockings/${interlockingId.replace("interlocking:", "")}.yaml`;

/** Delegates each declared journey boundary to InterlockingRunner. */
export class JourneyRunner {
  constructor(private readonly journeyYamlPath: string) {}

  /** Executes each declared route until the journey reaches one declared terminal. */
  async execute(action: string, inputs: Record<string, unknown>, context: ExecutionContext): Promise<JourneyExecution> {
    const declared = Bun.YAML.parse(readFileSync(this.journeyYamlPath, "utf8")) as JourneyDeclaration;
    if (!declared?.entrypoint?.interlocking_id || !declared.entrypoint.actions?.includes(action))
      throw new Error(`invalid journey entrypoint: ${this.journeyYamlPath}`);
    let current = declared.entrypoint.interlocking_id;
    let seed = context.initialArtifacts;
    const traversed = [] as string[];
    for (let hops = 0; hops < 32; hops++) {
      const path = pathFor(current);
      const run = await new InterlockingRunner(path).execute(action, inputs, seed, context.handlers);
      const key = `${run.resolution.interlockingId}/${run.resolution.routeId}`;
      traversed.push(run.resolution.interlockingId);
      const continuation = declared.continuations.find(
        (item) => item.from.interlocking_id === run.resolution.interlockingId && item.from.route_id === run.resolution.routeId,
      );
      const terminal = declared.terminals.find(
        (item) => item.from.interlocking_id === run.resolution.interlockingId && item.from.route_id === run.resolution.routeId,
      );
      if (terminal) return Object.freeze({
        ...run.executed,
        journey: Object.freeze({ terminal, outcome: terminal.outcome, interlockings: Object.freeze(traversed) }),
      });
      if (continuation && !context.continueOnContinuation)
        // Deployment composition can stop at a declared boundary without fabricating its successor.
        return Object.freeze({
          ...run.executed,
          journey: Object.freeze({ continuation, interlockings: Object.freeze(traversed) }),
        });
      if (continuation) {
        if (!continuation.to?.interlocking_id || !continuation.artifact)
          throw new Error(`invalid journey continuation at ${key}`);
        current = continuation.to.interlocking_id;
        // The next train receives only the planner-declared handoff from the prior execution.
        seed = { [continuation.artifact]: run.executed.terminal.value };
        continue;
      }
      throw new Error(`journey route is not declared as a continuation or terminal: ${key}`);
    }
    throw new Error(`journey continuation limit exceeded: ${this.journeyYamlPath}`);
  }
}
