import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Ajv from "ajv";

const root = resolve(import.meta.dir, "..");
type Edge = Record<string, unknown> & { source_ref: string; target_ref: string; type: string; origin?: string };
const graph = Bun.YAML.parse(await readFile(join(root, "relationships.yaml"), "utf8")) as { graph_id: string; nodes: string[]; edges: Edge[] };

/** Every convention the package ships, from planner-nodes/ and conventions/, by rule_id. */
async function shippedConventions(): Promise<string[]> {
  const ids: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".convention.yaml")) { const id = (Bun.YAML.parse(await readFile(path, "utf8")) as { rule_id?: string }).rule_id; if (id) ids.push(id); }
    }
  };
  await walk(join(root, "planner-nodes/nodes")); await walk(join(root, "conventions"));
  return ids.sort();
}

test("no convention the package ships is an orphan: each appears in at least one relationship edge", async () => {
  const related = new Set(graph.edges.flatMap(edge => [edge.source_ref, edge.target_ref]));
  const orphans = (await shippedConventions()).filter(id => !related.has(id));
  expect(orphans, `orphaned conventions; add a relationship edge for each in relationships.yaml`).toEqual([]);
});

test("the graph's node list is exactly the shipped conventions", async () => {
  expect([...graph.nodes].sort()).toEqual(await shippedConventions());
});

test("every edge is well-formed, unique, and touches a shipped convention", async () => {
  const shipped = new Set(await shippedConventions());
  const validate = new Ajv({ allErrors: true }).compile(JSON.parse(await readFile(join(root, "planner-schemas/author/relationship.schema.json"), "utf8")));
  const keys = new Set<string>();
  for (const edge of graph.edges) {
    const key = `${edge.source_ref} -${edge.type}-> ${edge.target_ref}`;
    expect(validate(edge), `${key}: ${JSON.stringify(validate.errors)}`).toBeTrue();
    expect(keys.has(key), `duplicate edge ${key}`).toBeFalse(); keys.add(key);
    expect(shipped.has(edge.source_ref) || shipped.has(edge.target_ref), `${key} touches no shipped convention`).toBeTrue();
    expect(typeof edge.origin === "string" && edge.origin.length > 0, `${key} records its origin`).toBeTrue();
    if (edge.origin === graph.graph_id) expect(shipped.has(edge.source_ref), `package edge ${key} starts at a shipped convention`).toBeTrue();
  }
});
