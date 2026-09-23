/**
 * Append package-native relationship edges and refresh the node list from the shipped conventions.
 *
 *   bun scripts/relationships.ts [edges.json]
 *
 * edges.json is a list of [source, type, target, reason, strength?, foundation?]. Every convention the
 * package ships must appear in at least one edge; tests/relationships.test.ts enforces it.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type Edge = Record<string, unknown> & { source_ref: string; type: string; target_ref: string };
const root = resolve(import.meta.dir, ".."), path = join(root, "relationships.yaml");
const raw = await readFile(path, "utf8"), header = raw.slice(0, raw.indexOf("schema_version:"));
const graph = Bun.YAML.parse(raw) as { schema_version: string; graph_id: string; nodes: string[]; edges: Edge[] };

async function ruleIds(dir: string): Promise<string[]> {
  const ids: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) ids.push(...await ruleIds(file));
    else if (entry.name.endsWith(".convention.yaml")) { const id = (Bun.YAML.parse(await readFile(file, "utf8")) as { rule_id?: string })?.rule_id; if (id) ids.push(id); }
  }
  return ids;
}

const existing = new Set(graph.edges.map(e => `${e.source_ref}|${e.type}|${e.target_ref}`));
const rows = process.argv[2] ? JSON.parse(await readFile(process.argv[2], "utf8")) as string[][] : [];
for (const [source_ref, type, target_ref, reason, strength = "important", foundation = type === "runs_alongside" ? "start_to_start" : "finish_to_start"] of rows) {
  if (existing.has(`${source_ref}|${type}|${target_ref}`)) continue;
  graph.edges.push({ confidence: 1.0, constraint: "mandatory", control: "internal", foundation, reason, source_ref, strength, target_ref, type, origin: graph.graph_id });
}
graph.nodes = [...await ruleIds(join(root, "conventions")), ...await ruleIds(join(root, "planner-nodes/nodes"))].sort();
await writeFile(path, header + Bun.YAML.stringify(graph, null, 2) + "\n");
const related = new Set(graph.edges.flatMap(e => [e.source_ref, e.target_ref]));
console.log(`${graph.nodes.length} nodes, ${graph.edges.length} edges, orphans: ${JSON.stringify(graph.nodes.filter(n => !related.has(n)))}`);
