import { readFileSync } from "node:fs";
import { TrainRunner, type ExecutedTrain, type WagonHandlerRegistry } from "./runner.ts";

export type InterlockingResolution = Readonly<{
  interlockingId: string;
  routeId: string;
  trainId: string;
  trainPath: string;
  category: string;
  guardId: string;
  resolutionStrategy: string;
  reason: string;
}>;
export type InterlockedExecution = Readonly<{ resolution: InterlockingResolution; executed: ExecutedTrain }>;

type Route = Readonly<{ route_id: string; train_id: string; train_path: string; guard: Readonly<{ id: string; input: string }> }>;

/** Resolves one route from the parsed declaration without transcribing route or train values. */
export class InterlockingRunner {
  constructor(private readonly interlockingYamlPath: string) {}

  async resolveTrain(action: string, inputs: Record<string, unknown>): Promise<InterlockingResolution> {
    const declared = Bun.YAML.parse(readFileSync(this.interlockingYamlPath, "utf8")) as {
      interlocking_id: string;
      entrypoint: { actions: readonly string[] };
      route_resolution: { strategy: string };
      routes: readonly Route[];
    };
    if (!declared.entrypoint.actions.includes(action))
      throw new Error(`action ${action} is not declared by ${declared.interlocking_id}`);
    const matching = declared.routes.filter((route) => Boolean(inputs[route.guard.input]));
    if (matching.length !== 1)
      throw new Error(`${declared.interlocking_id} ${declared.route_resolution.strategy} selected ${matching.length} routes`);
    const selected = matching[0]!;
    return Object.freeze({
      interlockingId: declared.interlocking_id,
      routeId: selected.route_id,
      trainId: selected.train_id,
      trainPath: selected.train_path,
      category: "declared",
      resolutionStrategy: declared.route_resolution.strategy,
      guardId: selected.guard.id,
      reason: `guard ${selected.guard.id} held`,
    });
  }

  /** Selects exactly one declared train, then delegates its wagon execution. */
  async execute(
    action: string,
    inputs: Record<string, unknown>,
    initialArtifacts: Record<string, unknown>,
    handlers: WagonHandlerRegistry,
  ): Promise<InterlockedExecution> {
    const selected = await this.resolveTrain(action, inputs);
    // Selection occurs once and the selected YAML path determines execution.
    return Object.freeze({
      resolution: selected,
      executed: await new TrainRunner(selected.trainPath, handlers).execute(
        selected,
        initialArtifacts,
      ),
    });
  }
}
