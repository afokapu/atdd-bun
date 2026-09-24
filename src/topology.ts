import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type Topology = { planRoot: string; sourceRoot: string; testRoot: string; e2eRoot: string; telemetryRoot: string };

export const defaultTopology: Topology = {
  planRoot: "plan",
  sourceRoot: "src/wagons",
  testRoot: "tests/wagons",
  e2eRoot: "e2e",
  telemetryRoot: "telemetry",
};

const configuredKeys: Array<[keyof Topology, string]> = [
  ["planRoot", "plan_root"],
  ["sourceRoot", "source_root"],
  ["testRoot", "test_root"],
  ["e2eRoot", "e2e_root"],
  ["telemetryRoot", "telemetry_root"],
];

function safeRelative(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.startsWith("/")) return null;
  const normalized = value.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized && !normalized.split("/").includes("..") ? normalized : null;
}

/** Read the one shared topology configuration used by every plan consumer. Invalid
 * location overrides deliberately fall back to the strict defaults; the topology
 * detector reports the bad configuration as a violation. */
export async function topologyFor(root = process.cwd()): Promise<Topology> {
  const absolute = resolve(root), file = join(absolute, "atdd-bun.yaml");
  if (!existsSync(file)) return { ...defaultTopology };
  try {
    const data = Bun.YAML.parse(await readFile(file, "utf8")) as { topology?: Record<string, unknown> } | null;
    const supplied = data?.topology && typeof data.topology === "object" && !Array.isArray(data.topology) ? data.topology : {};
    const topology = { ...defaultTopology };
    for (const [property, key] of configuredKeys) topology[property] = safeRelative(supplied[key]) ?? topology[property];
    return topology;
  } catch { return { ...defaultTopology }; }
}
