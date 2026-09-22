import { validatePlan, type PlanArtifact, type PlanFinding } from "./planner-kernel";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const finding = (rule_id: string, file: string, evidence: string): PlanFinding => ({ rule_id, file, evidence });
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const duplicate = (values: string[]) => [...new Set(values.filter((value, index) => value && values.indexOf(value) !== index))];
const contractIdentity = (value: string) => value.startsWith("contract:") ? value.slice("contract:".length) : value;

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

type ContractRegistry = { identities: Set<string>; rows: Record<string, unknown>[]; file: string };

async function contractRegistry(root: string): Promise<ContractRegistry | null> {
  const file = "contracts/_contracts.yaml", path = join(resolve(root), file);
  if (!existsSync(path)) return null;
  try {
    const data = Bun.YAML.parse(await readFile(path, "utf8")) as { contracts?: unknown };
    const source = data?.contracts;
    const rows = Array.isArray(source) ? records(source) : source && typeof source === "object"
      ? Object.entries(source as Record<string, unknown>).flatMap(([identity, entry]) => entry && typeof entry === "object" && !Array.isArray(entry) ? [{ ...(entry as Record<string, unknown>), identity: text((entry as Record<string, unknown>).identity) || identity }] : [])
      : [];
    return { identities: new Set(rows.map(row => text(row.identity)).filter(Boolean)), rows, file };
  } catch {
    return null;
  }
}

async function themeRegistryFindings(root: string, graph: Awaited<ReturnType<typeof validatePlan>>, registry: ContractRegistry | null): Promise<PlanFinding[]> {
  const absolute = resolve(root), file = "plan/_themes.yaml", path = join(absolute, file);
  const declared: Array<{ theme: string; file: string }> = [];
  for (const artifact of graph.artifacts) {
    if (artifact.kind === "wagon" || artifact.kind === "interlocking") {
      const theme = text(artifact.data.theme); if (theme) declared.push({ theme, file: artifact.file });
    } else if (artifact.kind === "train") {
      for (const theme of Array.isArray(artifact.data.themes) ? artifact.data.themes.map(text) : []) if (theme) declared.push({ theme, file: artifact.file });
    }
  }
  for (const row of registry?.rows ?? []) { const theme = text(row.theme); if (theme) declared.push({ theme, file: registry?.file ?? file }); }
  if (!existsSync(path)) return declared.length ? [finding("planner.theme.must-be-canonical", file, "themes are declared but plan/_themes.yaml is absent; add themes: { '0': commons } and repository-defined entries")] : [];
  try {
    const doc = Bun.YAML.parse(await readFile(path, "utf8")) as { themes?: unknown };
    const themes = doc?.themes && typeof doc.themes === "object" && !Array.isArray(doc.themes) ? doc.themes as Record<string, unknown> : {};
    const values = Object.values(themes).map(text).filter(Boolean);
    const findings: PlanFinding[] = [];
    if (themes["0"] !== "commons") findings.push(finding("planner.theme.theme-zero-mandatory", file, "theme index 0 must be the reserved token commons"));
    for (const name of duplicate(values)) findings.push(finding("planner.theme.must-be-canonical", file, `theme ${name} is declared at more than one index`));
    const known = new Set(values);
    for (const item of declared) if (!known.has(item.theme)) findings.push(finding("planner.theme.must-be-canonical", item.file, `theme ${item.theme} is not declared in plan/_themes.yaml`));
    for (const artifact of graph.artifacts.filter(item => item.kind === "wagon")) {
      const wagonTheme = text(artifact.data.theme);
      for (const produced of records(artifact.data.produce)) {
        const identities = [text(produced.name), text(produced.contract).replace(/^contract:/, ""), text(produced.telemetry).replace(/^telemetry:/, "")].filter(Boolean);
        for (const identity of identities) {
          const namespace = identity.split(":", 1)[0];
          if (!known.has(namespace)) findings.push(finding("planner.artifact-naming.theme-first-identity", artifact.file, `artifact ${identity} begins with undeclared theme ${namespace}`));
          if (wagonTheme && namespace !== wagonTheme) findings.push(finding("planner.theme.urn-namespace-matches", artifact.file, `artifact ${identity} begins with ${namespace}, but wagon ${text(artifact.data.wagon)} declares theme ${wagonTheme}`));
        }
      }
      for (const consumed of records(artifact.data.consume)) {
        const identity = text(consumed.name); if (!identity) continue;
        const namespace = identity.split(":", 1)[0];
        if (!known.has(namespace)) findings.push(finding("planner.artifact-naming.theme-first-identity", artifact.file, `artifact ${identity} begins with undeclared theme ${namespace}`));
      }
    }
    return findings;
  } catch {
    return [finding("planner.theme.must-be-canonical", file, "could not parse plan/_themes.yaml")];
  }
}

function contractRegistryFindings(root: string, wagons: PlanArtifact[], registry: ContractRegistry | null): PlanFinding[] {
  const findings: PlanFinding[] = [], byName = new Map<string, string[]>();
  for (const wagon of wagons) for (const item of records(wagon.data.consume)) {
    const name = text(item.name); if (name) byName.set(name, [...(byName.get(name) ?? []), text(wagon.data.wagon)]);
  }
  const references: Array<{ contract: string; kind: "produce" | "consume"; name: string; wagon: PlanArtifact; item: Record<string, unknown> }> = [];
  for (const wagon of wagons) for (const kind of ["produce", "consume"] as const) for (const item of records(wagon.data[kind])) {
    const contract = text(item.contract), name = text(item.name);
    if (contract) references.push({ contract, kind, name, wagon, item });
  }
  if (references.length && !registry) {
    for (const reference of references) findings.push(finding("planner.contract.registry-coherence", reference.wagon.file, `${reference.kind} ${reference.name} references ${reference.contract}, but contracts/_contracts.yaml is absent`));
    return findings;
  }
  const registered = registry?.identities ?? new Set<string>();
  const duplicateIdentities = duplicate((registry?.rows ?? []).map(row => text(row.identity)));
  for (const identity of duplicateIdentities) findings.push(finding("planner.contract.registry-coherence", registry?.file ?? "contracts/_contracts.yaml", `contract identity ${identity} is declared more than once`));
  for (const reference of references) if (reference.contract.startsWith("contract:") && !registered.has(contractIdentity(reference.contract))) {
    findings.push(finding("planner.contract.registry-coherence", reference.wagon.file, `${reference.kind} ${reference.name} references unregistered contract ${reference.contract}`));
  }
  for (const row of registry?.rows ?? []) {
    const identity = text(row.identity), theme = text(row.theme), expected = identity.split(":", 1)[0];
    if (identity && theme && theme !== expected) findings.push(finding("planner.contract.registry-coherence", registry.file, `contract ${identity} declares theme ${theme}; its identity namespace is ${expected}`));
    const path = text(row.path); if (path && !existsSync(join(resolve(root), path))) findings.push(finding("planner.contract.registry-coherence", registry.file, `contract ${identity} points to missing ${path}`));
  }
  for (const wagon of wagons) for (const produced of records(wagon.data.produce)) {
    const name = text(produced.name), contract = text(produced.contract), producer = text(wagon.data.wagon);
    const consumers = (byName.get(name) ?? []).filter(consumer => consumer && consumer !== producer);
    if (consumers.length && !contract) findings.push(finding("planner.contract.registry-coherence", wagon.file, `produce ${name} has contract null but is consumed cross-wagon by ${consumers.sort().join(", ")}`));
    if (contract && !consumers.length && text(produced.to || "external") !== "external") findings.push(finding("planner.contract.registry-coherence", wagon.file, `produce ${name} declares ${contract} but has no cross-wagon consumer and is not marked to: external`));
  }
  return findings;
}


type JourneyClaim = {
  kind: "continuation" | "terminal";
  interlockingId: string;
  routeId: string;
  artifact: string;
  destination: string;
};

function journeyContinuationFindings(graph: Awaited<ReturnType<typeof validatePlan>>): PlanFinding[] {
  const interlockings = new Map(graph.artifacts.filter(item => item.kind === "interlocking").map(item => [item.id, item]));
  const trains = new Map(graph.artifacts.filter(item => item.kind === "train").map(item => [item.id, item]));
  const findings: PlanFinding[] = [];

  for (const journey of graph.artifacts.filter(item => item.kind === "journey")) {
    const entrypoint = journey.data.entrypoint && typeof journey.data.entrypoint === "object" ? journey.data.entrypoint as Record<string, unknown> : {};
    const root = text(entrypoint.interlocking_id);
    const claims: JourneyClaim[] = [];

    for (const continuation of records(journey.data.continuations)) {
      const from = continuation.from && typeof continuation.from === "object" ? continuation.from as Record<string, unknown> : {};
      const to = continuation.to && typeof continuation.to === "object" ? continuation.to as Record<string, unknown> : {};
      claims.push({
        kind: "continuation",
        interlockingId: text(from.interlocking_id),
        routeId: text(from.route_id),
        artifact: text(continuation.artifact),
        destination: text(to.interlocking_id),
      });
    }
    for (const terminal of records(journey.data.terminals)) {
      const from = terminal.from && typeof terminal.from === "object" ? terminal.from as Record<string, unknown> : {};
      claims.push({
        kind: "terminal",
        interlockingId: text(from.interlocking_id),
        routeId: text(from.route_id),
        artifact: "",
        destination: "",
      });
    }

    const claimsByRoute = new Map<string, JourneyClaim[]>();
    for (const claim of claims) {
      const key = `${claim.interlockingId}#${claim.routeId}`;
      claimsByRoute.set(key, [...(claimsByRoute.get(key) ?? []), claim]);
      const source = interlockings.get(claim.interlockingId);
      if (!source) {
        findings.push(finding("planner.journey.continuation-closure", journey.file, `${journey.id} ${claim.kind} source interlocking ${claim.interlockingId || "<missing>"} does not exist`));
        continue;
      }
      const route = records(source.data.routes).find(row => text(row.route_id) === claim.routeId);
      if (!route) {
        findings.push(finding("planner.journey.continuation-closure", journey.file, `${journey.id} ${claim.kind} references missing route ${claim.interlockingId}#${claim.routeId || "<missing>"}`));
        continue;
      }
      if (claim.kind === "continuation") {
        const selectedTrain = text(route.train_id), train = trains.get(selectedTrain);
        const artifacts = train ? records(train.data.sequence).map(step => text(step.artifact)).filter(Boolean) : [];
        if (train && claim.artifact && !artifacts.includes(claim.artifact)) findings.push(finding(
          "planner.journey.continuation-closure",
          journey.file,
          `${journey.id} continuation ${claim.interlockingId}#${claim.routeId} waits for ${claim.artifact}, but selected train ${selectedTrain} declares [${artifacts.join(", ")}]`,
        ));
        if (claim.destination && !interlockings.has(claim.destination)) findings.push(finding(
          "planner.journey.continuation-closure",
          journey.file,
          `${journey.id} continuation ${claim.interlockingId}#${claim.routeId} targets missing ${claim.destination}`,
        ));
      }
    }

    const reachable = new Set<string>(), queue = root ? [root] : [];
    while (queue.length) {
      const interlockingId = queue.shift()!;
      if (reachable.has(interlockingId)) continue;
      const interlocking = interlockings.get(interlockingId);
      if (!interlocking) continue;
      reachable.add(interlockingId);
      const routeRows = records(interlocking.data.routes);
      for (const routeId of duplicate(routeRows.map(route => text(route.route_id)))) findings.push(finding(
        "planner.journey.continuation-closure",
        journey.file,
        `${journey.id} cannot key topology through ${interlockingId}: duplicate route_id ${routeId}`,
      ));
      for (const route of routeRows) {
        const routeId = text(route.route_id), key = `${interlockingId}#${routeId}`, outgoing = claimsByRoute.get(key) ?? [];
        if (outgoing.length !== 1) findings.push(finding(
          "planner.journey.continuation-closure",
          journey.file,
          `${journey.id} reachable route ${key} must have exactly one continuation or terminal; found ${outgoing.length}`,
        ));
        for (const edge of outgoing) if (edge.kind === "continuation" && interlockings.has(edge.destination)) queue.push(edge.destination);
      }
    }

    for (const claim of claims) if (claim.interlockingId && interlockings.has(claim.interlockingId) && !reachable.has(claim.interlockingId)) findings.push(finding(
      "planner.journey.continuation-closure",
      journey.file,
      `${journey.id} declares ${claim.kind} from unreachable ${claim.interlockingId}#${claim.routeId}`,
    ));

    const adjacency = new Map<string, Set<string>>();
    for (const claim of claims) if (claim.kind === "continuation" && reachable.has(claim.interlockingId) && reachable.has(claim.destination)) {
      adjacency.set(claim.interlockingId, new Set([...(adjacency.get(claim.interlockingId) ?? []), claim.destination]));
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    let cycle: string[] | null = null;
    const visit = (node: string, path: string[]): void => {
      if (cycle || visited.has(node)) return;
      if (visiting.has(node)) { const start = path.indexOf(node); cycle = [...path.slice(start), node]; return; }
      visiting.add(node);
      for (const next of adjacency.get(node) ?? []) visit(next, [...path, node]);
      visiting.delete(node);
      visited.add(node);
    };
    if (root) visit(root, []);
    if (cycle) findings.push(finding(
      "planner.journey.continuation-closure",
      journey.file,
      `${journey.id} contains a continuation cycle ${cycle.join(" -> ")}; journey topology is acyclic until explicit loop semantics exist`,
    ));
  }

  return findings;
}

/** Bun realization of the planner validators that depend only on committed plan
 * artifacts. Runtime/session/GitHub validators deliberately stay outside this package. */
export async function validateStaticPlannerConventions(root = process.cwd()): Promise<PlanFinding[]> {
  // Plan-graph integrity is a package guard with its own implementation contract.
  // This validator emits only the canonical convention ids declared by
  // planner.static.validators.bun.
  const graph = await validatePlan(root), findings: PlanFinding[] = [], wagons = graph.artifacts.filter(artifact => artifact.kind === "wagon");
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
  const registry = await contractRegistry(root);
  for (const [contract, owners] of contractOwners) if (owners.length > 1) findings.push(finding("planner.contract.registry-coherence", wagonBySlug.get(owners[0])?.file ?? "plan/", `contract ${contract} is produced by ${owners.join(", ")}`));
  for (const [telemetry, owners] of telemetryOwners) if (owners.length > 1) findings.push(finding("planner.wagon.telemetry-filesystem", wagonBySlug.get(owners[0])?.file ?? "plan/", `telemetry ${telemetry} is produced by ${owners.join(", ")}`));
  findings.push(...contractRegistryFindings(root, wagons, registry));
  findings.push(...await themeRegistryFindings(root, graph, registry));
  findings.push(...await trainRegistryFindings(root));
  findings.push(...journeyContinuationFindings(graph));

  return findings;
}
