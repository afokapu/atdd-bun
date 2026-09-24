import { expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { implementationsFor, runImplementation } from "../src/enforce";

const packageRoot = resolve(import.meta.dir, "..");
const detectors = join(packageRoot, "detectors");
const conventions = join(packageRoot, "conventions");
const plannerNodes = join(packageRoot, "planner-nodes");

async function emittedRuleIds(implementation: string): Promise<string[]> {
  const manifest = await readFile(join(detectors, implementation, "atdd.implementation.yaml"), "utf8");
  // Guards are held to the same per-rule checks as every detector: a convention and a failing case
  // for each rule they emit. Exempting them is how 13 rules once shipped with neither.
  const ids: string[] = [];
  let inList = false;
  for (const line of manifest.split("\n")) {
    if (line === "emits_rule_ids:") { inList = true; continue; }
    if (inList && /^[A-Za-z_][\w-]*:/.test(line)) break;
    const match = inList && line.match(/^\s*-\s+([^#]+?)(?:\s+#.*)?$/);
    if (match) ids.push(match[1].trim());
  }
  return ids;
}

async function filesBelow(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  }));
  return nested.flat();
}

test("the package ships every current Bun implementation", () => {
  expect(implementationsFor(["all"])).toEqual([
    "atdd_topology",
    "atdd_traceability_closure",
    "bun_clean_architecture_detector",
    "bun_design_system_detector",
    "bun_fullstack_detector",
    "bun_green_traceability_detector",
    "bun_interlocking_binding",
    "bun_interlocking_coverage",
    "bun_interlocking_infrastructure",
    "bun_responsive_detector",
    "bun_security_hygiene_detector",
    "bun_tester_discipline_detector",
    "bun_ts_metrics_detector",
    "htmx_e2e_detector",
    "htmx_hypermedia_detector",
    "htmx_tester_detector",
    "planner_docs_capability",
    "planner_plan_integrity",
    "planner_schema_validation",
    "planner_static_validators",
    "planner_telemetry_plan",
  ]);
});

test("every shipped detector runs under Bun with no Python bridge", async () => {
  for (const implementation of implementationsFor(["all"])) {
    const fixture = join(detectors, implementation, "fixtures");
    expect((await stat(join(fixture, "clean"))).isDirectory(), `${implementation} clean fixture`).toBeTrue();
    expect((await stat(join(fixture, "dirty"))).isDirectory(), `${implementation} dirty fixture`).toBeTrue();
    expect(await runImplementation(implementation, { scanRoots: [join(fixture, "clean")], excludes: ["node_modules", ".git", ".atdd"] }), `${implementation} clean`).toEqual([]);
    expect((await runImplementation(implementation, { scanRoots: [join(fixture, "dirty")], excludes: ["node_modules", ".git", ".atdd"] })).length, `${implementation} dirty`).toBeGreaterThan(0);
  }
}, 20_000);

test("the dirty corpus triggers every declared convention rule", async () => {
  const conventionContents = await Promise.all((await Promise.all([filesBelow(conventions), filesBelow(plannerNodes)])).flat().map((path) => readFile(path, "utf8")));
  for (const implementation of implementationsFor(["all"])) {
    const fixtureNames = implementation === "planner_docs_capability"
      ? ["dirty_markdown", "dirty_identity", "dirty_duplicate_id", "dirty_unresolved_edge", "dirty_missing_index", "dirty_adr_registry", "dirty_journey_view"]
      : ["dirty"];
    const groups = await Promise.all(fixtureNames.map(async (name) => runImplementation(implementation, { scanRoots: [join(detectors, implementation, "fixtures", name)], excludes: ["node_modules", ".git", ".atdd"] })));
    const observed = new Set(groups.flat().map((violation) => violation.rule_id)), declared = await emittedRuleIds(implementation);
    for (const ruleId of observed) expect(declared.includes(ruleId), `${implementation} emits ${ruleId} without declaring it in emits_rule_ids`).toBeTrue();
    for (const ruleId of declared) {
      expect(conventionContents.some((content) => content.includes(`rule_id: ${ruleId}`)), `${ruleId} convention ships`).toBeTrue();
      expect(observed.has(ruleId), `${implementation} dirty fixture triggers ${ruleId}`).toBeTrue();
    }
  }
}, 20_000);
