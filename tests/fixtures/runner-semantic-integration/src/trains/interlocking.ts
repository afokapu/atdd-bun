import { readFileSync } from "node:fs";
export interface InterlockingResolution { interlockingId: string; routeId: string; trainId: string; trainPath: string; category: string; guardId: string; resolutionStrategy: string; reason: string; }
export class InterlockingRunner {
  constructor(private readonly path: string) {}
  resolveTrain(_action: string, _inputs: Record<string, unknown>): InterlockingResolution {
    const text = readFileSync(this.path, "utf8");
    const routeId = /route_id:\s*(\S+)/.exec(text)?.[1] ?? "";
    const trainId = /train_id:\s*(\S+)/.exec(text)?.[1] ?? "";
    const trainPath = /train_path:\s*(\S+)/.exec(text)?.[1] ?? "";
    const interlockingId = /interlocking_id:\s*(\S+)/.exec(text)?.[1] ?? "";
    return { interlockingId, routeId, trainId, trainPath, category: "nominal", guardId: "guard:declared", resolutionStrategy: "first", reason: "declared" };
  }
  execute(action: string, inputs: Record<string, unknown>) { return this.resolveTrain(action, inputs); }
}
