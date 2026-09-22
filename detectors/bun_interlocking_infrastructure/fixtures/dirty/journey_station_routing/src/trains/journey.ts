import { InterlockingRunner } from "@app/interlocking-runtime";

export class JourneyRunner {
  constructor(private readonly journeyYamlPath: string) {}

  async execute(action: string, inputs: Record<string, unknown>, state?: unknown) {
    const declaration = Bun.YAML.parse(await Bun.file(this.journeyYamlPath).text()) as {
      entrypoint: { interlocking_id: string };
    };
    const id = declaration.entrypoint.interlocking_id.replace("interlocking:", "");
    const path = `plan/_trains/_interlockings/${id}.yaml`;
    return new InterlockingRunner(path).execute(action, inputs, state);
  }
}
