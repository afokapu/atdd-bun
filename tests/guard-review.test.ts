import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkDocumentation } from "../src/docs-capability";
import { runImplementation } from "../src/enforce";

// Regressions for the adversarial review of PR #14 (Codex). Each test is the reproduction that proved
// the finding, now asserting the fixed behaviour.
const root = resolve(import.meta.dir, "..");
async function repo(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "atdd-guard-review-"));
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), content); }
  return dir;
}
const run = async (implementation: string, dir: string) => (await runImplementation(implementation, { scanRoots: [dir], excludes: [] })).map(v => `${v.rule_id} ${v.evidence}`);
/** The rules a manifest DECLARES it emits: only its emits_rule_ids and api_emits_rule_ids lists, never realizes_convention. */
const declared = async (implementation: string) => {
  const ids: string[] = []; let inList = false;
  for (const line of (await readFile(join(root, "detectors", implementation, "atdd.implementation.yaml"), "utf8")).split("\n")) {
    if (line === "emits_rule_ids:" || line === "api_emits_rule_ids:") { inList = true; continue; }
    if (/^[A-Za-z_][\w-]*:/.test(line)) { inList = false; continue; }
    const match = inList && line.match(/^\s*-\s+([^#\s]+)/);
    if (match) ids.push(match[1]);
  }
  return ids;
};

test("#1 a plan artifact without identity reports a declared rule, never a raw kernel id", async () => {
  const dir = await repo({ "plan/_trains/_interlockings/unnamed.yaml": "participants: []\nroutes: []\n" });
  try {
    const ids = (await run("planner_plan_integrity", dir)).map(f => f.split(" ")[0]);
    expect(ids).toEqual(["atdd-bun.planner.identity-required"]);
    expect(await declared("planner_plan_integrity")).toContain("atdd-bun.planner.identity-required");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#2 every rule the documentation API emits is declared by the docs manifest", async () => {
  const result = await checkDocumentation({ root: join(root, "detectors/planner_docs_capability/fixtures/clean"), declaration: { impact: "typo", artifacts: [] }, changeSet: ["docs/new.adoc"], render: async () => ({ findings: [{ rule_id: "planner.docs.reference-integrity" as const, file: "docs/a.adoc", line: 1, col: 1, evidence: "broken xref", source_line: "" }] }) });
  const emitted = [...new Set(result.findings.map(f => f.rule_id).filter(Boolean))] as string[];
  expect(emitted.sort()).toEqual(["planner.docs.artifact-path-shape", "planner.docs.reference-integrity", "planner.docs.undeclared-change"]);
  const manifest = await declared("planner_docs_capability");
  for (const id of emitted) expect(manifest, id).toContain(id);
});

const featurePlan = {
  "plan/orders/_orders.yaml": "urn: wagon:orders\nwagon: orders\nfeatures: [feature:orders:a, feature:orders:b]\n",
  "plan/orders/a.yaml": "urn: feature:orders:a\nwagon: wagon:orders\nwmbts: [wmbt:orders:E001]\n",
  "plan/orders/b.yaml": "urn: feature:orders:b\nwagon: wagon:orders\nwmbts: [wmbt:orders:E002]\n",
  "plan/orders/E001.yaml": "urn: wmbt:orders:E001\nstatement: s\nacceptances:\n  - identity: { urn: acc:orders:E001-UNIT-001 }\n",
  "plan/orders/E002.yaml": "urn: wmbt:orders:E002\nstatement: s\nacceptances:\n  - identity: { urn: acc:orders:E002-UNIT-001 }\n",
  "src/wagons/orders/features/a/domain/thing.ts": "// URN: component:orders:a:Thing:backend:domain\nexport class Thing {}\n",
  "src/wagons/orders/features/b/domain/thing.ts": "// URN: component:orders:b:Thing:backend:domain\nexport class Thing {}\n",
  "tests/wagons/orders/features/b/unit/b.test.ts": "// URN: test:orders:b:E002-UNIT-001\n// Acceptance: acc:orders:E002-UNIT-001\nimport { test } from \"bun:test\";\ntest(\"b\", () => {});\n",
};

test("#3 a test is credited only to the feature that owns the acceptance it binds", async () => {
  const dir = await repo({ ...featurePlan, "tests/wagons/orders/features/a/unit/a.test.ts": "// URN: test:orders:a:E002-UNIT-001\n// Acceptance: acc:orders:E002-UNIT-001\nimport { test } from \"bun:test\";\ntest(\"a\", () => {});\n" });
  try {
    const findings = await run("atdd_topology", dir);
    expect(findings.some(f => f.startsWith("atdd-bun.topology.test-location acc:orders:E002-UNIT-001 belongs to feature:orders:b, not feature:orders:a"))).toBeTrue();
    expect(findings.some(f => f.startsWith("atdd-bun.topology.feature-test-coverage feature:orders:a"))).toBeTrue();
    expect(findings.some(f => f.includes("feature:orders:b owns WMBTs but has no test"))).toBeFalse();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#4 every typed interlocking participant resolves; user: and system: are external actors", async () => {
  const dir = await repo({ "plan/_trains/_interlockings/checkout.yaml": "interlocking_id: interlocking:checkout\nparticipants: [feature:ghost, user:buyer, system:gateway]\nroutes: []\n" });
  try { expect((await run("planner_plan_integrity", dir)).filter(f => f.startsWith("atdd-bun.planner.interlocking-participant-resolves"))).toEqual(["atdd-bun.planner.interlocking-participant-resolves interlocking:checkout lists undeclared feature:ghost"]); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test("#5 feature layout is judged only once the plan models a wagon, feature or WMBT, as the conventions now say", async () => {
  const dir = await repo({ "src/wagons/orders/features/a/domain/invalid.ts": "export const invalid = 1;\n" });
  try {
    expect(await run("atdd_topology", dir)).toEqual([]);
    for (const rule of ["source-location", "test-location"]) expect((Bun.YAML.parse(await readFile(join(root, `conventions/atdd-bun.topology/atdd-bun.topology.${rule}.convention.yaml`), "utf8")) as { statement: string }).statement).toStartWith("When the plan models at least one wagon, feature or WMBT");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#6 a journey E2E test binds a declared acceptance that agrees with its URN", async () => {
  const fixture = join(root, "detectors/atdd_topology/fixtures/clean"), dir = await mkdtemp(join(tmpdir(), "atdd-guard-review-"));
  try {
    await Bun.$`cp -R ${fixture}/. ${dir}/`.quiet();
    const journey = join(dir, "e2e/journeys/checkout.journey.test.ts");
    await writeFile(journey, (await readFile(journey, "utf8")).replace(/^\/\/ Acceptance:.*\n/m, ""));
    expect((await run("atdd_topology", dir)).filter(f => f.startsWith("atdd-bun.topology.e2e-location"))).toEqual(["atdd-bun.topology.e2e-location journey E2E test requires Acceptance: acc:orders:E001-E2E-001, declared by a WMBT in plan/"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#7 _generated is never scanned, by the topology gate or the plan kernel", async () => {
  const dir = await repo({ "plan/_generated/wagon.yaml": "urn: wagon:generated\nwagon: generated\n", "plan/_generated/broken.yaml": "broken: [yaml\n" });
  try {
    expect(await run("atdd_topology", dir)).toEqual([]);
    expect(await run("planner_plan_integrity", dir)).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
