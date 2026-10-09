import { InterlockingRunner } from "@app/interlocking-runtime";

export class JourneyRunner {
  constructor(private readonly journeyYamlPath: string) {}

  async execute(action: string, inputs: Record<string, unknown>, state?: unknown) {
    const declaration = Bun.YAML.parse(await Bun.file(this.journeyYamlPath).text()) as any;
    let current = declaration.entrypoint.interlocking_id;
    for (;;) {
      const id = current.replace("interlocking:", "");
      const resolution = await new InterlockingRunner(`plan/_trains/_interlockings/${id}.yaml`).execute(action, inputs, state);
      const continuation = declaration.continuations.find((edge: any) => edge.from.route_id === resolution.routeId);
      if (continuation) { current = current; continue; }
      const terminal = declaration.terminals.find((edge: any) => edge.from.route_id === resolution.routeId);
      if (terminal) return resolution;
    }
  }
}
