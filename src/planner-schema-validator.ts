import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadPlan, type PlanArtifact, type PlanFinding } from "./planner-kernel";

type SchemaKind = Extract<PlanArtifact["kind"], "wagon" | "feature" | "wmbt" | "train" | "interlocking" | "journey">;

const schemaFiles: Record<SchemaKind, string> = {
  wagon: "wagon.schema.json",
  feature: "feature.schema.json",
  wmbt: "wmbt.schema.json",
  train: "train.schema.json",
  interlocking: "train-interlocking.schema.json",
  journey: "journey.schema.json",
};
const supportingSchemaFiles = ["appendix.schema.json", "acceptance.schema.json"];
const repositorySchemas = [
  { file: "plan/_themes.yaml", schema: "theme-registry.schema.json", rule: "planner.theme.must-be-canonical" },
  { file: "contracts/_contracts.yaml", schema: "contract-registry.schema.json", rule: "planner.contract.registry-coherence" },
] as const;
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

async function validators(): Promise<{ artifacts: Map<SchemaKind, ValidateFunction>; repositories: Map<string, ValidateFunction> }> {
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
  addFormats(ajv);
  const files = [...supportingSchemaFiles, ...Object.values(schemaFiles), ...repositorySchemas.map(item => item.schema)];
  for (const file of files) ajv.addSchema(JSON.parse(await readFile(join(schemaDirectory, file), "utf8")), file);
  const artifacts = new Map(Object.entries(schemaFiles).map(([kind, file]) => {
    const validator = ajv.getSchema(file);
    if (!validator) throw new Error("could not compile planner schema " + file);
    return [kind as SchemaKind, validator];
  }));
  const repositories = new Map(repositorySchemas.map(item => {
    const validator = ajv.getSchema(item.schema);
    if (!validator) throw new Error("could not compile planner schema " + item.schema);
    return [item.schema, validator];
  }));
  return { artifacts, repositories };
}

function repositoryRule(file: string, fallback: string, error: ErrorObject): string {
  if (file === "plan/_themes.yaml" && (error.instancePath === "/themes" || error.instancePath === "/themes/0" || error.params.missingProperty === "0")) {
    return "planner.theme.theme-zero-mandatory";
  }
  return fallback;
}

/** Validate every recognized plan artifact against the package-shipped canonical
 * JSON Schema. Cross-artifact relationships remain planner validator concerns. */
export async function validatePlannerSchemas(root = process.cwd()): Promise<PlanFinding[]> {
  const absolute = resolve(root), graph = await loadPlan(absolute);
  const byKind = await validators();
  const findings: PlanFinding[] = [];
  for (const artifact of graph.artifacts) {
    if (!(artifact.kind in schemaFiles)) continue;
    const kind = artifact.kind as SchemaKind, validator = byKind.artifacts.get(kind);
    if (!validator) continue;
    if (!validator(artifact.data)) {
      for (const error of validator.errors ?? []) findings.push({
        rule_id: ruleFor(kind, error),
        file: artifact.file,
        evidence: kind + " violates " + schemaFiles[kind] + ": " + formatError(error),
      });
    }
  }
  for (const item of repositorySchemas) {
    const path = join(absolute, item.file);
    if (!existsSync(path)) continue;
    try {
      const data = Bun.YAML.parse(await readFile(path, "utf8"));
      const repositoryValidator = byKind.repositories.get(item.schema);
      if (!repositoryValidator) throw new Error("could not compile planner schema " + item.schema);
      if (!repositoryValidator(data)) for (const error of repositoryValidator.errors ?? []) findings.push({
        rule_id: repositoryRule(item.file, item.rule, error),
        file: item.file,
        evidence: item.file + " violates " + item.schema + ": " + formatError(error),
      });
    } catch (error) {
      findings.push({ rule_id: item.rule, file: item.file, evidence: `could not parse ${item.file}: ${String(error)}` });
    }
  }
  return findings;
}

export { ruleId as PLANNER_SCHEMA_RULE_ID };
