import { InterlockingRunner } from "./interlocking";
export class JourneyRunner {
  constructor(private readonly journeyYamlPath: string) {}
  async execute(action: string, inputs: Record<string, unknown>) {
    const declaration = Bun.YAML.parse(await Bun.file(this.journeyYamlPath).text());
    let current = declaration.entrypoint.interlocking_id;
    let path = declaration.entrypoint.interlocking_path;
    for (;;) {
      const resolution = await new InterlockingRunner(path).execute(action, inputs);
      const continuation = declaration.continuations.find((edge: any) => edge.from.interlocking_id === current && edge.from.route_id === resolution.routeId);
      if (continuation) { current = continuation.to.interlocking_id; path = continuation.to.path; continue; }
      const terminal = declaration.terminals.find((edge: any) => edge.from.interlocking_id === current && edge.from.route_id === resolution.routeId);
      if (terminal) return { resolution, outcome: terminal.outcome };
      throw new Error(`undeclared journey outcome for ${current}`);
    }
  }
}
