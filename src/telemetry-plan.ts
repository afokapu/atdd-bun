import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { loadPlan, type PlanFinding } from "./planner-kernel";
import { topologyFor } from "./topology";

/** The telemetry tracking-plan validator: the plan-side half of the telemetry profile.
 *
 * A tracking plan is the versioned source of truth for what a repository observes. The
 * telemetry/ tree declares concrete items (event / trace / metric / log per plane); wagons
 * own the logical artifacts they realize; every acceptance makes an explicit decision —
 * `required` (with items that must resolve into the tree) or `not-applicable` (with a
 * rationale). The capability is inert until adopted: no telemetry root and no acceptance
 * telemetry declaration means no findings, so upgrading the package changes nothing for a
 * repository that has not opted in. */

const KINDS = ["event", "trace", "metric", "log"] as const;
const PLANES = ["ui", "ux", "be", "nw", "db", "st", "tm", "sc", "au", "fn", "if"] as const;
const MEASURES = ["latency", "duration", "throughput", "error_rate", "success_rate", "count", "size", "age", "staleness", "freshness"] as const;
const SEGMENT = "[a-z][a-z0-9-]*";
export const CONCRETE_URN = new RegExp(`^telemetry:(?:${KINDS.join("|")}):(?:${PLANES.join("|")}):${SEGMENT}:${SEGMENT}(?::(?:${MEASURES.join("|")}))?$`);
const FILE_NAME = new RegExp(`^(event|trace|metric|log)\\.(${PLANES.join("|")})(?:\\.(${MEASURES.join("|")}))?\\.json$`);
const SEGMENT_PATTERN = new RegExp(`^${SEGMENT}$`);
const schemaFile = join(resolve(import.meta.dir, ".."), "planner-schemas", "telemetry-plan.schema.json");

export type TelemetryPlanItem = { file: string; data: Record<string, unknown> };
/** One file under the telemetry root: its place in the tree, its parsed body, or why it would not parse. */
export type TelemetryFile = { file: string; segments: string[]; data: Record<string, unknown> | null; error?: string };

const finding = (rule_id: string, file: string, evidence: string): PlanFinding => ({ rule_id, file, evidence });
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const records = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? value.filter(entry => entry && typeof entry === "object" && !Array.isArray(entry)) : []);

async function walk(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  }))).flat().sort();
}

async function itemValidator(): Promise<ValidateFunction> {
  const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(await readFile(schemaFile, "utf8")));
}

/** Wagon ownership of logical telemetry artifacts, from produce[].telemetry entries (string or list). */
function telemetryOwners(wagons: Array<{ id: string; data: Record<string, unknown> }>): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const wagon of wagons) {
    const slug = text(wagon.data.wagon) || wagon.id.replace(/^wagon:/, "");
    for (const entry of records(wagon.data.produce)) {
      const declared = entry.telemetry;
      for (const value of Array.isArray(declared) ? declared.map(text) : [text(declared)]) {
        if (value) owners.set(value, [...(owners.get(value) ?? []), slug]);
      }
    }
  }
  return owners;
}

/** Load the tracking plan: the adoption gate plus every file under the telemetry root, parsed or not.
 * Shared by the plan-side validator and the code-side detector, so both judge the same registry. */
export async function loadTelemetryFiles(root = process.cwd()): Promise<{ adopted: boolean; files: TelemetryFile[] }> {
  const absolute = resolve(root), topology = await topologyFor(absolute);
  const telemetryRoot = join(absolute, topology.telemetryRoot);
  const { artifacts } = await loadPlan(absolute);
  // Adoption is a positive act: create the telemetry root, or let any acceptance declare a telemetry
  // decision. Until then the capability is inert — an upgraded package must not fail an unadopting repo.
  const adopted = existsSync(telemetryRoot) || artifacts.some(artifact => artifact.kind === "acceptance" && artifact.data.telemetry !== undefined);
  const files: TelemetryFile[] = [];
  for (const path of await walk(telemetryRoot)) {
    const file = relative(absolute, path).replaceAll("\\", "/");
    const segments = relative(telemetryRoot, path).replaceAll("\\", "/").split("/");
    try {
      const data: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) { files.push({ file, segments, data: null, error: "tracking-plan item must be a JSON object" }); continue; }
      files.push({ file, segments, data: data as Record<string, unknown> });
    } catch (error) {
      files.push({ file, segments, data: null, error: `could not parse tracking-plan item: ${String(error)}` });
    }
  }
  return { adopted, files };
}

export async function validateTelemetryPlan(root = process.cwd()): Promise<PlanFinding[]> {
  const absolute = resolve(root), topology = await topologyFor(absolute);
  const { adopted, files } = await loadTelemetryFiles(absolute);
  if (!adopted) return [];

  const findings: PlanFinding[] = [], validate = await itemValidator(), items: TelemetryPlanItem[] = [], byId = new Map<string, TelemetryPlanItem>();

  for (const entry of files) {
    const { file, segments } = entry;
    const name = segments.at(-1) ?? "", match = FILE_NAME.exec(name);
    if (segments.length !== 3 || !match || !SEGMENT_PATTERN.test(segments[0]) || !SEGMENT_PATTERN.test(segments[1])) {
      findings.push(finding("planner.telemetry.tracking-plan-schema", file, `tracking-plan files live at ${topology.telemetryRoot}/<theme>/<artifact>/{event|trace|metric|log}.<plane>[.<measure>].json; found ${file}`));
      continue;
    }
    if (!entry.data) {
      findings.push(finding("planner.telemetry.tracking-plan-schema", file, entry.error ?? "tracking-plan item must be a JSON object"));
      continue;
    }
    const record = entry.data;
    if (!validate(record)) {
      for (const error of validate.errors ?? []) findings.push(finding(
        "planner.telemetry.tracking-plan-schema", file,
        `${file} violates telemetry-plan.schema.json: ${error.instancePath || "/"} ${error.message ?? error.keyword}`,
      ));
    }
    items.push({ file, data: record });

    // Path mirrors identity: the file's place in the tree is the authority for id, logical artifact,
    // kind, plane and measure. A renamed file or a hand-edited id cannot drift apart silently.
    const [theme, artifact] = segments, kind = match[1], plane = match[2], measure = match[3] ?? null;
    if (text(record.kind) !== kind) findings.push(finding("planner.telemetry.tracking-plan-schema", file, `kind '${text(record.kind) || "<missing>"}' does not match file name ${name}`));
    if (text(record.plane) !== plane) findings.push(finding("planner.telemetry.tracking-plan-schema", file, `plane '${text(record.plane) || "<missing>"}' does not match file name ${name}`));
    if (kind === "metric") {
      if (!measure) findings.push(finding("planner.telemetry.tracking-plan-schema", file, `metric items carry a measure segment: metric.<plane>.<measure>.json (found ${name})`));
      else if (text(record.measure) && text(record.measure) !== measure) findings.push(finding("planner.telemetry.tracking-plan-schema", file, `measure '${text(record.measure)}' does not match file name ${name}`));
    } else if (measure) {
      findings.push(finding("planner.telemetry.tracking-plan-schema", file, `only metric items carry a measure segment (found ${name})`));
    }
    const expectedId = `telemetry:${kind}:${plane}:${theme}:${artifact}${measure ? `:${measure}` : ""}`;
    if (text(record.id) !== expectedId) findings.push(finding("planner.telemetry.tracking-plan-schema", file, `id '${text(record.id) || "<missing>"}' does not mirror its path; expected '${expectedId}'`));
    const expectedLogical = `telemetry:${theme}:${artifact}`;
    if (text(record.logical_artifact) !== expectedLogical) findings.push(finding("planner.telemetry.tracking-plan-schema", file, `logical_artifact '${text(record.logical_artifact) || "<missing>"}' does not mirror its path; expected '${expectedLogical}'`));
    const declared = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties) ? Object.keys(record.properties as Record<string, unknown>) : [];
    for (const name of (Array.isArray(record.required) ? record.required : []).map(text)) {
      if (name && !declared.includes(name)) findings.push(finding("planner.telemetry.tracking-plan-schema", file, `required property '${name}' is not declared in properties`));
    }
    const id = text(record.id), previous = byId.get(id);
    if (id && previous) findings.push(finding("planner.telemetry.tracking-plan-schema", file, `concrete telemetry '${id}' is declared by both ${previous.file} and ${file}`));
    else if (id) byId.set(id, { file, data: record });
  }

  const plan = await loadPlan(absolute);
  const acceptances = plan.artifacts.filter(artifact => artifact.kind === "acceptance");

  // Every concrete item resolves to exactly one wagon-owned logical artifact, and owner names that wagon.
  const owners = telemetryOwners(plan.artifacts.filter(artifact => artifact.kind === "wagon"));
  for (const item of items) {
    const logical = text(item.data.logical_artifact);
    if (!logical) continue; // the schema finding already names it
    const owning = owners.get(logical) ?? [];
    if (!owning.length) findings.push(finding("planner.telemetry.logical-ownership", item.file, `logical artifact ${logical} is produced by no wagon; declare it in exactly one wagon's produce[] telemetry`));
    else if (owning.length > 1) findings.push(finding("planner.telemetry.logical-ownership", item.file, `logical artifact ${logical} is produced by wagons ${owning.join(", ")}`));
    else if (text(item.data.owner) && text(item.data.owner) !== owning[0]) findings.push(finding("planner.telemetry.logical-ownership", item.file, `owner '${text(item.data.owner)}' does not match the owning wagon '${owning[0]}'`));
  }

  // Every acceptance makes an explicit decision; required items resolve into the tracking plan, and the
  // plan's references back out of the tree resolve to declared acceptances.
  const registryIds = new Set(items.map(item => text(item.data.id)).filter(Boolean));
  const acceptanceIds = new Set(acceptances.map(acceptance => acceptance.id));
  for (const acceptance of acceptances) {
    const decision = acceptance.data.telemetry;
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
      findings.push(finding("planner.telemetry.acceptance-decision", acceptance.file, `${acceptance.id} declares no telemetry decision; declare telemetry: { disposition: required, events: [...] } or telemetry: { disposition: not-applicable, rationale: ... }`));
      continue;
    }
    const disposition = text((decision as Record<string, unknown>).disposition);
    if (disposition === "required") {
      const urns = ["events", "metrics", "traces", "logs"].flatMap(key => (Array.isArray((decision as Record<string, unknown>)[key]) ? (decision as Record<string, unknown>)[key] : []).map(text));
      if (!urns.length) findings.push(finding("planner.telemetry.acceptance-decision", acceptance.file, `${acceptance.id} is disposition: required but declares no telemetry items`));
      for (const urn of urns) {
        if (!urn) { findings.push(finding("planner.telemetry.acceptance-decision", acceptance.file, `${acceptance.id} declares an empty telemetry item`)); continue; }
        if (!CONCRETE_URN.test(urn)) findings.push(finding("planner.telemetry.acceptance-decision", acceptance.file, `${urn} is not a concrete telemetry URN telemetry:{kind}:{plane}:{theme}:{artifact}[:{measure}]`));
        else if (!registryIds.has(urn)) findings.push(finding("planner.telemetry.acceptance-decision", acceptance.file, `${urn} has no tracking-plan entry under ${topology.telemetryRoot}/`));
      }
    } else if (disposition === "not-applicable") {
      const rationale = text((decision as Record<string, unknown>).rationale).trim();
      if (rationale.length < 20) findings.push(finding("planner.telemetry.acceptance-decision", acceptance.file, `${acceptance.id} is disposition: not-applicable without a rationale (at least 20 characters)`));
    } else {
      findings.push(finding("planner.telemetry.acceptance-decision", acceptance.file, `${acceptance.id} telemetry.disposition must be required or not-applicable, found '${disposition || "<missing>"}'`));
    }
  }
  for (const item of items) {
    for (const reference of (Array.isArray(item.data.acceptances) ? item.data.acceptances : []).map(text)) {
      if (reference && !acceptanceIds.has(reference)) findings.push(finding("planner.telemetry.acceptance-decision", item.file, `${text(item.data.id) || item.file} references undeclared acceptance ${reference}`));
    }
  }

  // High-cardinality identifiers are forbidden as metric labels; they belong in event, log and trace
  // properties where the plan justifies them.
  for (const item of items) {
    if (text(item.data.kind) !== "metric") continue;
    const properties = item.data.properties && typeof item.data.properties === "object" && !Array.isArray(item.data.properties) ? item.data.properties as Record<string, Record<string, unknown>> : {};
    for (const dimension of records(item.data.dimensions)) {
      const name = text(dimension.name);
      if (!name) continue;
      if (text(dimension.cardinality) === "high") findings.push(finding("planner.telemetry.metric-cardinality", item.file, `${text(item.data.id)} dimension '${name}' is high-cardinality; carry the identifier in an event, log or trace property instead`));
      else if (properties[name] && text(properties[name].cardinality) === "high") findings.push(finding("planner.telemetry.metric-cardinality", item.file, `${text(item.data.id)} dimension '${name}' names a property declared cardinality: high`));
    }
  }

  return findings;
}
