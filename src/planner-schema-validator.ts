import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadPlan, type PlanArtifact, type PlanFinding } from "./planner-kernel";

type SchemaKind = Extract<PlanArtifact["kind"], "wagon" | "feature" | "wmbt" | "train" | "interlocking">;

const schemaFiles: Record<SchemaKind, string> = {
  wagon: "wagon.schema.json",
  feature: "feature.schema.json",
  wmbt: "wmbt.schema.json",
  train: "train.schema.json",
  interlocking: "train-interlocking.schema.json",
};
const supportingSchemaFiles = ["appendix.schema.json", "acceptance.schema.json"];
const schemaDirectory = join(resolve(import.meta.dir, ".."), "planner-schemas");
const ruleId = "atdd-bun.planner.schema";

function ruleFor(kind: SchemaKind, error: ErrorObject): string {
  if (error.keyword === "pattern" && (
    (kind === "train" && error.instancePath === "/train_id") ||
    (kind === "interlocking" && /^\/routes\/\d+\/train_id$/.test(error.instancePath))
  )) return "planner.train.naming";
  return ruleId;
}

function formatError(error: ErrorObject): string {
  const at = error.instancePath || "/";
  return at + " " + (error.message ?? error.keyword);
}

async function validators(): Promise<Map<SchemaKind, ValidateFunction>> {
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
  addFormats(ajv);
  const files = [...supportingSchemaFiles, ...Object.values(schemaFiles)];
  for (const file of files) ajv.addSchema(JSON.parse(await readFile(join(schemaDirectory, file), "utf8")), file);
  return new Map(Object.entries(schemaFiles).map(([kind, file]) => {
    const validator = ajv.getSchema(file);
    if (!validator) throw new Error("could not compile planner schema " + file);
    return [kind as SchemaKind, validator];
  }));
}

/** Validate every recognized plan artifact against the package-shipped canonical
 * JSON Schema. Cross-artifact relationships remain planner validator concerns. */
export async function validatePlannerSchemas(root = process.cwd()): Promise<PlanFinding[]> {
  const graph = await loadPlan(root);
  const byKind = await validators();
  const findings: PlanFinding[] = [];
  for (const artifact of graph.artifacts) {
    if (!(artifact.kind in schemaFiles)) continue;
    const kind = artifact.kind as SchemaKind, validator = byKind.get(kind);
    if (!validator) continue;
    if (!validator(artifact.data)) {
      for (const error of validator.errors ?? []) findings.push({
        rule_id: ruleFor(kind, error),
        file: artifact.file,
        evidence: kind + " violates " + schemaFiles[kind] + ": " + formatError(error),
      });
    }
  }
  return findings;
}

export { ruleId as PLANNER_SCHEMA_RULE_ID };
