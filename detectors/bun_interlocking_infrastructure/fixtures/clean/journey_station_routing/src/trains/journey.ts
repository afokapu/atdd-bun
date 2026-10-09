import { InterlockingRunner } from "@app/interlocking-runtime";

export class JourneyRunner {
  constructor(private readonly journeyYamlPath: string) {}

  async execute(action: string, inputs: Record<string, unknown>, state?: unknown) {
    const declaration = Bun.YAML.parse(await Bun.file(this.journeyYamlPath).text()) as {
      entrypoint: { interlocking_id: string };
      continuations: Array<{ from: { interlocking_id: string; route_id: string }; to: { interlocking_id: string } }>;
      terminals: Array<{ from: { interlocking_id: string; route_id: string }; outcome: string }>;
    };
    let current = declaration.entrypoint.interlocking_id;
    for (;;) {
      const id = current.replace("interlocking:", "");
      const path = `plan/_trains/_interlockings/${id}.yaml`;
      const resolution = await new InterlockingRunner(path).execute(action, inputs, state);
      const continuation = declaration.continuations.find(edge => edge.from.interlocking_id === current && edge.from.route_id === resolution.routeId);
      if (continuation) {
        current = continuation.to.interlocking_id;
        continue;
      }
      const terminal = declaration.terminals.find(edge => edge.from.interlocking_id === current && edge.from.route_id === resolution.routeId);
      if (terminal) return { resolution, outcome: terminal.outcome };
      throw new Error(`Journey topology has no outcome for ${current}`);
    }
  }
}
