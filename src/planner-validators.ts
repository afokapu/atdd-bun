import { validatePlan, type PlanArtifact, type PlanFinding } from "./planner-kernel";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const finding = (rule_id: string, file: string, evidence: string): PlanFinding => ({ rule_id, file, evidence });
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const duplicate = (values: string[]) => [...new Set(values.filter((value, index) => value && values.indexOf(value) !== index))];
const typedTrainId = /^train:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

async function yamlFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => entry.isDirectory() ? yamlFiles(join(root, entry.name)) : entry.isFile() && entry.name.endsWith(".yaml") ? [join(root, entry.name)] : []))).flat().sort();
}

async function trainRegistryFindings(root: string): Promise<PlanFinding[]> {
  const absolute = resolve(root), registryPath = join(absolute, "plan/_trains.yaml"); if (!existsSync(registryPath)) return [];
  const registry = Bun.YAML.parse(await readFile(registryPath, "utf8")) as { trains?: Record<string, Record<string, unknown[]>> };
  const rows = Object.values(registry?.trains ?? {}).flatMap(buckets => Object.values(buckets ?? {}).flat()).filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  const registered = new Set<string>(), findings: PlanFinding[] = [];
  for (const row of rows) { const path = text(row.path), train = text(row.train_id); if (!path || !train) continue; registered.add(path); if (!existsSync(join(absolute, path))) findings.push(finding("planner.train.registry-coherence", "plan/_trains.yaml", `registry train ${train} points to missing ${path}`)); }
  const trainRoot = join(absolute, "plan/_trains");
  for (const path of await yamlFiles(trainRoot)) { const rel = relative(absolute, path).replaceAll("\\", "/"), pieces = relative(trainRoot, path).split(/[\\/]/); if (pieces.some(piece => piece.startsWith("_")) || registered.has(rel)) continue; findings.push(finding("planner.train.registry-coherence", rel, `train document is not registered in plan/_trains.yaml`)); }
  return findings;
}

/** Bun realization of the planner validators that depend only on committed plan
 * artifacts. Runtime/session/GitHub validators deliberately stay outside this package. */
export async function validateStaticPlannerConventions(root = process.cwd()): Promise<PlanFinding[]> {
  // Plan-graph integrity is a package guard with its own implementation contract.
  // This validator emits only the canonical convention ids declared by
  // planner.static.validators.bun.
  const graph = await validatePlan(root), findings: PlanFinding[] = [], wagons = graph.artifacts.filter(artifact => artifact.kind === "wagon");
  for (const train of graph.artifacts.filter(artifact => artifact.kind === "train")) {
    if (!typedTrainId.test(train.id)) findings.push(finding("planner.train.naming", train.file, `train_id must use train:<subject>:<slug>; found ${train.id}`));
  }
  for (const interlocking of graph.artifacts.filter(artifact => artifact.kind === "interlocking")) {
    for (const route of records(interlocking.data.routes)) {
      const trainId = text(route.train_id);
      if (trainId && !typedTrainId.test(trainId)) findings.push(finding("planner.train.naming", interlocking.file, `route train_id must use train:<subject>:<slug>; found ${trainId}`));
    }
  }
  const wagonSlugs = new Set(wagons.map(wagon => text(wagon.data.wagon)));
  const wagonBySlug = new Map(wagons.map(wagon => [text(wagon.data.wagon), wagon]));
  const wagonIds = wagons.map(wagon => text(wagon.data.wagon));
  for (const slug of duplicate(wagonIds)) findings.push(finding("planner.wagon.urn", wagonBySlug.get(slug)?.file ?? "plan/", `wagon slug ${slug} is declared more than once`));

  const contractOwners = new Map<string, string[]>(), telemetryOwners = new Map<string, string[]>();
  for (const wagon of wagons) {
    const slug = text(wagon.data.wagon), expected = `wagon:${slug}`;
    if (!slug || wagon.id !== expected) findings.push(finding("planner.wagon.urn-naming", wagon.file, `wagon identity must be ${expected}`));
    const produced = records(wagon.data.produce), consumed = records(wagon.data.consume);
    for (const name of duplicate(produced.map(item => text(item.name)))) findings.push(finding("planner.wagon.produce-consume-artifacts", wagon.file, `${expected} produces ${name} more than once`));
    for (const feature of duplicate(records(wagon.data.features).map(item => text(item.urn)))) findings.push(finding("planner.wagon.features", wagon.file, `${expected} lists feature ${feature} more than once`));
    for (const item of produced) {
      const contract = text(item.contract), telemetry = item.telemetry; if (contract) contractOwners.set(contract, [...(contractOwners.get(contract) ?? []), slug]);
      for (const value of Array.isArray(telemetry) ? telemetry.map(text) : [text(telemetry)]) if (value) telemetryOwners.set(value, [...(telemetryOwners.get(value) ?? []), slug]);
      const to = text(item.to || "external"); if (to !== "external" && to !== "internal" && (!to.startsWith("wagon:") || !wagonSlugs.has(to.slice(6)))) findings.push(finding("planner.wagon.produce-consume-artifacts", wagon.file, `${expected} produces to invalid destination ${to}`));
    }
    for (const item of consumed) {
      const from = text(item.from); if (!from) continue;
      if (from.startsWith("wagon:")) { const target = from.slice(6); if (!wagonSlugs.has(target)) findings.push(finding("planner.wagon.produce-consume-artifacts", wagon.file, `${expected} consumes from unknown ${from}`)); else if (target === slug) findings.push(finding("planner.wagon.no-consume-cycle", wagon.file, `${expected} consumes from itself`)); }
      else if (!from.startsWith("system:") && !from.startsWith("appendix:") && from !== "internal") findings.push(finding("planner.wagon.produce-consume-artifacts", wagon.file, `${expected} has invalid consume source ${from}`));
    }
  }
  // This is only the duplicate-producer predicate of the contract-registry
  // convention. The scope manifest records the remaining predicates as unported.
  for (const [contract, owners] of contractOwners) if (owners.length > 1) findings.push(finding("planner.contract.registry-coherence", wagonBySlug.get(owners[0])?.file ?? "plan/", `contract ${contract} is produced by ${owners.join(", ")}`));
  for (const [telemetry, owners] of telemetryOwners) if (owners.length > 1) findings.push(finding("planner.wagon.telemetry-filesystem", wagonBySlug.get(owners[0])?.file ?? "plan/", `telemetry ${telemetry} is produced by ${owners.join(", ")}`));
  findings.push(...await trainRegistryFindings(root));

  return findings;
}
