import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

type Node = Record<string, unknown>;

async function nodePaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => entry.isDirectory()
    ? nodePaths(join(directory, entry.name))
    : entry.name.endsWith(".yaml") ? [join(directory, entry.name)] : []))).flat();
}

function asRecord(value: unknown): Node | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Node
    : undefined;
}

test("every planner convention node conforms to its canonical node-schema invariants", async () => {
  const root = join(import.meta.dir, "..");
  const schema = JSON.parse(await readFile(join(root, "planner-schemas/author/convention-node.schema.json"), "utf8"));
  const allowedKinds = new Set<string>(schema.properties.kind.enum);
  const allowedStatuses = new Set<string>(schema.properties.status.enum);
  const allowedImplementationTypes = new Set<string>(schema.properties.implementation.properties.type.enum);
  const allowedPhases = new Set<string>(schema.properties.validation.properties.phase.enum);
  const nodeFiles = await nodePaths(join(root, "planner-nodes/nodes"));
  const failures: string[] = [];

  for (const file of nodeFiles) {
    const relative = file.slice(root.length + 1);
    const node = asRecord(Bun.YAML.parse(await readFile(file, "utf8")));
    if (!node) { failures.push(`${relative}: expected mapping`); continue; }
    for (const field of schema.required as string[]) {
      if (!(field in node)) failures.push(`${relative}: missing required ${field}`);
    }
    if (typeof node.schema_version !== "string") failures.push(`${relative}: schema_version must be string`);
    if (typeof node.rule_id !== "string" || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(node.rule_id)) failures.push(`${relative}: invalid rule_id`);
    if (typeof node.kind !== "string" || !allowedKinds.has(node.kind)) failures.push(`${relative}: invalid kind`);
    if (typeof node.status !== "string" || !allowedStatuses.has(node.status)) failures.push(`${relative}: invalid status`);
    if (typeof node.statement !== "string" || node.statement.length === 0) failures.push(`${relative}: statement must be non-empty string`);

    const implementation = asRecord(node.implementation);
    if (implementation && (typeof implementation.type !== "string" || !allowedImplementationTypes.has(implementation.type))) failures.push(`${relative}: invalid implementation.type`);
    const metadata = asRecord(node.metadata);
    if (metadata && "introduced_in" in metadata && typeof metadata.introduced_in !== "string") failures.push(`${relative}: metadata.introduced_in must be string`);
    const validation = asRecord(node.validation);
    if (validation && "phase" in validation && (typeof validation.phase !== "string" || !allowedPhases.has(validation.phase))) failures.push(`${relative}: invalid validation.phase`);

    if (!Array.isArray(node.terms) || node.terms.length === 0) { failures.push(`${relative}: terms must be a non-empty array`); continue; }
    for (const [index, term] of node.terms.entries()) {
      const record = asRecord(term);
      if (!record) { failures.push(`${relative}: terms[${index}] must be mapping`); continue; }
      if (typeof record.term_id !== "string" || !/^[a-z][a-z0-9_]*$/.test(record.term_id)) failures.push(`${relative}: invalid terms[${index}].term_id`);
      if (typeof record.text !== "string") failures.push(`${relative}: terms[${index}].text must be string`);
    }
  }

  expect(nodeFiles).toHaveLength(195);
  expect(failures).toEqual([]);
});

test("the WMBT semantic anchor uses the schema-defined meaning", async () => {
  const root = join(import.meta.dir, "..");
  const definition = Bun.YAML.parse(await readFile(join(root, "planner-nodes/nodes/planner.wmbt.definition.convention.yaml"), "utf8")) as Node;
  expect(definition.statement).toContain("What Must Be True");
  expect(definition.statement).not.toContain("What-Might-Break");
});
