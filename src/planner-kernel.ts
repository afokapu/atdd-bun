import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { NESTED_WORKTREES, topologyFor } from "./topology";

export type PlanKind = "wagon" | "feature" | "wmbt" | "acceptance" | "train" | "interlocking" | "journey" | "contract";
export type PlanFinding = { rule_id: string; file: string; evidence: string };
export type PlanArtifact = { kind: PlanKind; id: string; file: string; data: Record<string, unknown> };
export type PlanGraph = { artifacts: PlanArtifact[]; findings: PlanFinding[] };

const typedKinds: Record<string, PlanKind> = { wagon: "wagon", feature: "feature", wmbt: "wmbt", acc: "acceptance", train: "train", interlocking: "interlocking", journey: "journey", contract: "contract" };
const id = (value: unknown) => typeof value === "string" ? value : "";
const finding = (rule_id: string, file: string, evidence: string): PlanFinding => ({ rule_id, file, evidence });

/** Plan files beneath `root`. `skip` holds absolute directories that are not this plan: nested agent worktrees
 * (another checkout, visible when plan_root is `.`), dependencies and Git metadata. */
async function walk(root: string, skip: Set<string>): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory() && (entry.name === "_generated" || entry.name === "node_modules" || entry.name === ".git" || skip.has(path))) return [];
    return entry.isDirectory() ? walk(path, skip) : entry.isFile() && /\.(?:yaml|yml|json)$/.test(entry.name) ? [path] : [];
  }))).flat().sort();
}

function kindOf(data: Record<string, unknown>, path: string): PlanKind | null {
  if (id(data.journey_id)) return "journey";
  if (id(data.interlocking_id)) return "interlocking";
  const urn = id(data.urn); if (urn) { const prefix = urn.split(":", 1)[0]; return typedKinds[prefix] ?? null; }
  if (id(data.train_id)) return "train";
  if (Array.isArray(data.participants) && Array.isArray(data.routes)) return "interlocking";
  if ("wagon" in data) return "wagon";
  if ("$id" in data && id(data.$id).startsWith("contract:")) return "contract";
  return null;
}

function artifactId(kind: PlanKind, data: Record<string, unknown>): string {
  if (kind === "wagon") return id(data.urn) || (id(data.wagon) ? `wagon:${id(data.wagon)}` : "");
  if (kind === "train") return id(data.train_id) || id(data.urn);
  if (kind === "contract") return id(data.$id);
  if (kind === "interlocking") return id(data.interlocking_id);
  if (kind === "journey") return id(data.journey_id);
  return id(data.urn) || id(data.id);
}

function values(value: unknown): unknown[] { return Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value as Record<string, unknown>) : []; }
function typedRefs(value: unknown): string[] {
  if (typeof value === "string") return [...value.matchAll(/\b(?:wagon|feature|wmbt|acc|train|interlocking|journey|contract):[a-z][a-z0-9-]*(?::[A-Za-z0-9._-]+)*/g)].map(match => match[0]);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(typedRefs);
}

function structuralRefs(artifact: PlanArtifact): string[] {
  const data = artifact.data, out: string[] = [];
  const add = (value: unknown) => { if (typeof value === "string" && /^(?:wagon|feature|wmbt|acc|train|interlocking|journey|contract):/.test(value)) out.push(value); };
  if (artifact.kind === "wagon") for (const feature of values(data.features)) add(feature && typeof feature === "object" ? (feature as Record<string, unknown>).urn : feature);
  if (artifact.kind === "feature") { add(data.wagon); for (const wmbt of values(data.wmbts)) add(wmbt); }
  if (artifact.kind === "train") { const source = data.source_interlocking; if (source && typeof source === "object") add((source as Record<string, unknown>).interlocking_id); for (const participant of values(data.participants)) add(participant); for (const step of values(data.sequence)) if (step && typeof step === "object") { add((step as Record<string, unknown>).from); add((step as Record<string, unknown>).to); } }
  if (artifact.kind === "interlocking") { for (const life of values(data.lifelines)) add(life && typeof life === "object" ? (life as Record<string, unknown>).ref : life); for (const message of values(data.messages)) if (message && typeof message === "object") { const record = message as Record<string, unknown>; add(record.from); add(record.to); for (const wmbt of values(record.wmbt_refs)) add(wmbt); } for (const route of values(data.routes)) if (route && typeof route === "object") add((route as Record<string, unknown>).train_id); }
  if (artifact.kind === "journey") {
    const entrypoint = data.entrypoint; if (entrypoint && typeof entrypoint === "object") add((entrypoint as Record<string, unknown>).interlocking_id);
    for (const continuation of values(data.continuations)) if (continuation && typeof continuation === "object") { const record = continuation as Record<string, unknown>; const from = record.from, to = record.to; if (from && typeof from === "object") add((from as Record<string, unknown>).interlocking_id); if (to && typeof to === "object") add((to as Record<string, unknown>).interlocking_id); }
    for (const terminal of values(data.terminals)) if (terminal && typeof terminal === "object") { const from = (terminal as Record<string, unknown>).from; if (from && typeof from === "object") add((from as Record<string, unknown>).interlocking_id); }
  }
  return out;
}

/** Load plan artifacts with Bun's native YAML parser. It is read-only and deliberately
 * excludes authoring/session/store behavior from ATDD core. */
export async function loadPlan(root = process.cwd()): Promise<PlanGraph> {
  const absolute = resolve(root), topology = await topologyFor(absolute), plan = join(absolute, topology.planRoot), artifacts: PlanArtifact[] = [], findings: PlanFinding[] = [];
  for (const path of await walk(plan, new Set(NESTED_WORKTREES.map(dir => join(absolute, dir))))) {
    const file = relative(absolute, path).replaceAll("\\", "/");
    try {
      const text = await readFile(path, "utf8"); const data = path.endsWith(".json") ? JSON.parse(text) : Bun.YAML.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const record = data as Record<string, unknown>, kind = kindOf(record, file); if (!kind) continue;
      const artifact = artifactId(kind, record); if (!artifact) { findings.push(finding("planner.kernel.identity-required", file, `${kind} artifact has no canonical identity`)); continue; }
      artifacts.push({ kind, id: artifact, file, data: record });
      // WMBTs and trains both embed acceptances (a train's are acc:train:<subject>:<slug>:<name>).
      if (kind === "wmbt" || kind === "train") for (const acceptance of values(record.acceptances)) {
        if (!acceptance || typeof acceptance !== "object") { findings.push(finding("planner.kernel.acceptance-well-formed", file, "acceptance must be an object")); continue; }
        const identity = (acceptance as { identity?: { urn?: unknown } }).identity; const acceptanceId = identity && typeof identity === "object" ? id((identity as { urn?: unknown }).urn) : "";
        if (!acceptanceId.startsWith("acc:")) findings.push(finding("planner.kernel.acceptance-well-formed", file, "embedded acceptance has no acc: identity.urn"));
        else artifacts.push({ kind: "acceptance", id: acceptanceId, file, data: acceptance as Record<string, unknown> });
      }
    } catch (error) { findings.push(finding("planner.kernel.parse", file, `could not parse artifact: ${String(error)}`)); }
  }
  return { artifacts, findings };
}

/** Validate the closed artifact graph: identity uniqueness, typed references, train
 * wagon members, interlocking participants/routes, journey topology references, and WMBT acceptance ownership. */
export async function validatePlan(root = process.cwd()): Promise<PlanGraph> {
  const graph = await loadPlan(root), byId = new Map<string, PlanArtifact[]>();
  for (const artifact of graph.artifacts) byId.set(artifact.id, [...(byId.get(artifact.id) ?? []), artifact]);
  for (const [artifact, owners] of byId) if (owners.length > 1) graph.findings.push(finding("planner.kernel.identity-unique", owners[0].file, `${artifact} is declared by ${owners.map(owner => owner.file).join(", ")}`));
  const known = new Set(byId.keys());
  for (const artifact of graph.artifacts) {
    const references = structuralRefs(artifact);
    for (const reference of new Set(references)) if (!known.has(reference) && !reference.startsWith("contract:")) graph.findings.push(finding("planner.kernel.reference-resolves", artifact.file, `${artifact.id} references undeclared ${reference}`));
    if (artifact.kind === "train") for (const wagon of values(artifact.data.wagons)) { const reference = `wagon:${id(wagon)}`; if (id(wagon) && !known.has(reference)) graph.findings.push(finding("planner.kernel.train-wagon-resolves", artifact.file, `${artifact.id} lists undeclared ${reference}`)); }
    if (artifact.kind === "interlocking") for (const participant of [...values(artifact.data.participants), ...values(artifact.data.lifelines).map(value => value && typeof value === "object" ? (value as Record<string, unknown>).ref : value)]) { const reference = id(participant); if (reference && !/^(user|system):/.test(reference) && !known.has(reference)) graph.findings.push(finding("planner.kernel.interlocking-participant-resolves", artifact.file, `${artifact.id} lists undeclared ${reference}`)); }
  }
  return graph;
}

export function traceabilityPlan(graph: PlanGraph): Array<{ from: string; to: string; relation: string }> {
  const links: Array<{ from: string; to: string; relation: string }> = [];
  for (const artifact of graph.artifacts) {
    if (artifact.kind === "wmbt") for (const acceptance of graph.artifacts.filter(other => other.kind === "acceptance" && other.file === artifact.file)) links.push({ from: artifact.id, to: acceptance.id, relation: "defines" });
    for (const reference of new Set(structuralRefs(artifact))) links.push({ from: artifact.id, to: reference, relation: "references" });
    if (artifact.kind === "train") for (const wagon of values(artifact.data.wagons)) if (id(wagon)) links.push({ from: artifact.id, to: `wagon:${id(wagon)}`, relation: "orders" });
  }
  return links;
}
