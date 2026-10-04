import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { concreteProfiles, declaredRuleIds, profileImplementations } from "./enforce";

export const PROFILE_REGISTRY_DIR = "conventions/_profiles";
type Convention = { rule_id: string; path: string };
type Relationship = Record<string, unknown> & { source_ref: string; target_ref: string; type: string };
type Graph = { edges: Relationship[] };

async function filesBelow(root: string, extension: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await filesBelow(path, extension));
    else if (entry.name.endsWith(extension)) out.push(path);
  }
  return out;
}

async function conventionIndex(root: string): Promise<Map<string, Convention>> {
  const index = new Map<string, Convention>();
  for (const base of ["planner-nodes/nodes", "conventions"]) for (const file of await filesBelow(join(root, base), ".convention.yaml")) {
    const rule_id = (Bun.YAML.parse(await readFile(file, "utf8")) as { rule_id?: unknown }).rule_id;
    if (typeof rule_id !== "string") continue;
    const path = relative(root, file).replaceAll("\\", "/");
    if (index.has(rule_id)) throw new Error(`multiple convention files declare ${rule_id}: ${index.get(rule_id)!.path}, ${path}`);
    index.set(rule_id, { rule_id, path });
  }
  return index;
}

const sorted = <T>(items: Iterable<T>, compare: (left: T, right: T) => number = (left, right) => String(left).localeCompare(String(right))) => [...items].sort(compare);
const relationshipKey = (edge: Relationship) => `${edge.source_ref}\u0000${edge.target_ref}\u0000${edge.type}`;
const scalar = (value: unknown) => value === null ? "null" : typeof value === "string" ? JSON.stringify(value) : typeof value === "number" || typeof value === "boolean" ? String(value) : (() => { throw new Error(`profile registry cannot render non-scalar value ${JSON.stringify(value)}`); })();
const fields = (value: Record<string, unknown>, indent: string) => sorted(Object.entries(value), ([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${indent}${key}: ${scalar(entry)}`);
const render = (profile: string, implementations: string[], conventions: Convention[], relationships: Relationship[]) => [
  'schema_version: "1.0.0"', `profile: ${scalar(profile)}`,
  "implementations:", ...implementations.map(implementation => `  - ${scalar(implementation)}`),
  "conventions:", ...conventions.flatMap(convention => [`  - rule_id: ${scalar(convention.rule_id)}`, `    path: ${scalar(convention.path)}`]),
  "relationships:", ...relationships.flatMap(edge => { const entries = fields(edge, "    "); return [`  - ${entries[0]!.slice(4)}`, ...entries.slice(1)]; }), "",
].join("\n");

/** Deterministically project profiles, detector manifests, conventions, and direct graph edges into small registries. */
export async function renderProfileRegistries(root = resolve(import.meta.dir, "..")): Promise<Map<string, string>> {
  const conventions = await conventionIndex(root);
  const graph = Bun.YAML.parse(await readFile(join(root, "relationships.yaml"), "utf8")) as Graph;
  if (!Array.isArray(graph.edges)) throw new Error("relationships.yaml has no edges list");
  const rendered = new Map<string, string>();
  for (const profile of concreteProfiles) {
    const implementations = sorted(profileImplementations[profile]);
    const declared = await Promise.all(implementations.map(implementation => declaredRuleIds(implementation, join(root, "detectors"))));
    const ruleIds = sorted(new Set(declared.flatMap(ids => [...ids])));
    const missing = ruleIds.filter(id => !conventions.has(id));
    if (missing.length) throw new Error(`${profile} declares rule IDs without exactly one convention: ${missing.join(", ")}`);
    const rules = new Set(ruleIds);
    const relationships = sorted(graph.edges.filter(edge => rules.has(edge.source_ref) || rules.has(edge.target_ref)), (left, right) => relationshipKey(left).localeCompare(relationshipKey(right)));
    rendered.set(`${PROFILE_REGISTRY_DIR}/${profile}.yaml`, render(profile, implementations, ruleIds.map(id => conventions.get(id)!), relationships));
  }
  return rendered;
}

/** Write or check the shipped profile registries. `check` reports every stale or unexpected generated file. */
export async function profileRegistries(options: { root?: string; check?: boolean } = {}) {
  const root = resolve(options.root ?? resolve(import.meta.dir, "..")), expected = await renderProfileRegistries(root), directory = join(root, PROFILE_REGISTRY_DIR);
  const actual = existsSync(directory) ? sorted((await readdir(directory)).filter(name => name.endsWith(".yaml")).map(name => `${PROFILE_REGISTRY_DIR}/${name}`)) : [];
  const files: string[] = [];
  for (const path of sorted(new Set([...expected.keys(), ...actual]))) if (!expected.has(path) || !existsSync(join(root, path)) || (await readFile(join(root, path), "utf8")) !== expected.get(path)) files.push(path);
  if (options.check) return { ok: !files.length, message: files.length ? `profile registries have drifted: ${files.join(", ")}; run: atdd-bun profiles registry` : "profile registries are current", files };
  await mkdir(directory, { recursive: true });
  for (const path of actual.filter(path => !expected.has(path))) await rm(join(root, path));
  for (const [path, content] of expected) await writeFile(join(root, path), content);
  return { ok: true, message: `wrote ${expected.size} profile registries`, files: sorted(expected.keys()) };
}
