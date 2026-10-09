import { InterlockingRunner } from "@app/interlocking-runtime";

export class JourneyRunner {
  constructor(private readonly journeyYamlPath: string) {}

  async execute(action: string, inputs: Record<string, unknown>, state?: unknown) {
    const declaration = Bun.YAML.parse(await Bun.file(this.journeyYamlPath).text()) as any;
    const id = declaration.entrypoint.interlocking_id.replace("interlocking:", "");
    const path = `plan/_trains/_interlockings/${id}.yaml`;
    const resolution = await new InterlockingRunner(path).execute(action, inputs, state);
    declaration.continuations.find((edge: any) => edge.from.route_id === resolution.routeId);
    declaration.terminals.find((edge: any) => edge.from.route_id === resolution.routeId);
    return resolution;
  }
}
