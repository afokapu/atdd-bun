import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { profileConventions } from "../src/enforce";

const root = resolve(import.meta.dir, "..");
const family = "planner.journey.execution-strategies";
const strategies = ["reference","conditional","concurrent","pipelined","batched","cached","speculative","adaptive"] as const;
const read = async (path: string) => Bun.YAML.parse(await readFile(join(root, path), "utf8")) as Record<string, unknown>;

test("each journey strategy is independently discoverable without claiming an unimplemented validator", async () => {
  const selected = new Map(profileConventions.planner.map(entry => [entry.rule_id, entry.path]));
  expect(selected.has("planner.journey.definition")).toBeTrue();
  expect(selected.has(family)).toBeTrue();
  expect((await read(selected.get(family)!)).kind).toBe("family");

  for (const slug of strategies) {
    const id = `planner.journey.strategy.${slug}`, path = selected.get(id);
    expect(path, `${id} is absent from the planner profile`).toBeDefined();
    const node = await read(path!);
    expect(node).toMatchObject({ rule_id: id, kind: "pattern", status: "active" });
    expect(node.implementation).toBeUndefined();
    expect(node.metadata).toMatchObject({ disposition: "advisory" });
    expect((node.terms as Array<{ term_id: string }>).map(term => term.term_id)).toEqual([
      "applicability", "constraints", "evidence", "runtime_boundary",
    ]);
  }
});

test("each strategy requires the existing journey ownership contract", async () => {
  const graph = await read("relationships.yaml");
  const edges = graph.edges as Array<{ source_ref: string; target_ref: string; type: string }>;
  expect(edges.some(e => e.source_ref === family && e.target_ref === "planner.journey.definition" && e.type === "requires")).toBeTrue();
  for (const slug of strategies) expect(
    edges.some(e => e.source_ref === `planner.journey.strategy.${slug}` && e.target_ref === family && e.type === "requires"),
    `${slug} is disconnected`,
  ).toBeTrue();
});

test("generated planner profile actually exposes the entire strategy catalog to agents", async () => {
  const profile = await read("conventions/_profiles/planner.yaml");
  const declared = new Set((profile.conventions as Array<{ rule_id: string }>).map(c => c.rule_id));
  expect(declared.has(family)).toBeTrue();
  for (const slug of strategies) expect(declared.has(`planner.journey.strategy.${slug}`)).toBeTrue();
});
