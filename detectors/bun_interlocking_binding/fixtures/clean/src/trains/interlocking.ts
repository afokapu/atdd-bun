// InterlockingRunner runtime — resolves declared routes into a structured InterlockingResolution.
//
// It READS the declaration it was handed. It used to return the answer as literals and
// ignore `interlockingYamlPath` entirely, which is the defect
// coder.bun.runtime-executes-the-declaration exists to catch: delete plan/ and a
// transcribing runtime keeps answering. A clean fixture must not model that.
import { readFileSync } from "node:fs";

export interface InterlockingResolution {
  interlockingId: string;
  routeId: string;
  trainId: string;
  trainPath: string;
  category: string;
  resolutionStrategy: string;
  guardId: string;
  reason: string;
}

type DeclaredRoute = Record<string, string>;

function readDeclaration(path: string): { interlockingId: string; strategy: string; routes: DeclaredRoute[] } {
  const text = readFileSync(path, "utf8");
  const routes: DeclaredRoute[] = [];
  let interlockingId = "";
  let strategy = "";
  let current: DeclaredRoute | null = null;
  for (const line of text.split(/\r?\n/)) {
    const id = line.match(/^interlocking_id:\s*(\S+)\s*$/);
    if (id) interlockingId = id[1];
    const st = line.match(/^\s{2}strategy:\s*(\S+)\s*$/);
    if (st) strategy = st[1];
    const start = line.match(/^\s*-\s*route_id:\s*(\S+)\s*$/);
    if (start) {
      current = { route_id: start[1] };
      routes.push(current);
      continue;
    }
    const kv = line.match(/^\s{4}(\w+):\s*(\S+)\s*$/);
    if (kv && current) current[kv[1]] = kv[2];
  }
  return { interlockingId, strategy, routes };
}

export class InterlockingRunner {
  constructor(private readonly interlockingYamlPath: string) {}

  resolveTrain(action: string, inputs: Record<string, unknown>): InterlockingResolution {
    const declaration = readDeclaration(this.interlockingYamlPath);
    const admissible = declaration.routes.filter((r) => r.category === "nominal");
    if (admissible.length !== 1) {
      throw new Error(`expected one admissible route, got ${admissible.length}`);
    }
    const route = admissible[0];
    return {
      interlockingId: declaration.interlockingId,
      routeId: route.route_id,
      trainId: route.train_id,
      trainPath: route.train_path,
      category: route.category,
      resolutionStrategy: declaration.strategy,
      guardId: route.guard_ref,
      reason: `guard ${route.guard_ref} held`,
    };
  }
}
