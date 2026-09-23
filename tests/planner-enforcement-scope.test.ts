import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { implementationsFor, runImplementation } from "../src/enforce";

const root = join(import.meta.dir, "..");

test("planner scope distinguishes canonical realizations, partial coverage, and package guards", async () => {
  const scope = Bun.YAML.parse(await readFile(join(root, "planner-nodes/ENFORCEMENT_SCOPE.yaml"), "utf8")) as {
    node_corpus: { count: number };
    canonical_bun_enforcement: Array<{ rule_id: string; coverage: string }>;
    reference_only: { count: number };
  };
  const files = await readdir(join(root, "planner-nodes/nodes"));
  const manifests = await Promise.all(["planner_static_validators", "planner_schema_validation", "atdd_topology"].map(async implementation =>
    Bun.YAML.parse(await readFile(join(root, "detectors", implementation, "atdd.implementation.yaml"), "utf8")) as { realizes_convention?: string[] },
  ));
  const scoped = scope.canonical_bun_enforcement.map(item => item.rule_id).sort();

  expect(files).toHaveLength(scope.node_corpus.count);
  expect(scope.reference_only.count + scoped.length).toBe(scope.node_corpus.count);
  expect([...new Set(manifests.flatMap(manifest => manifest.realizes_convention ?? []))].sort()).toEqual(scoped);
  expect(scope.canonical_bun_enforcement.filter(item => item.coverage === "complete").map(item => item.rule_id)).toEqual([
    "planner.train.naming", "planner.train.registry-coherence", "planner.journey.continuation-closure", "planner.journey.interlocking-composed",
    "planner.contract.registry-coherence", "planner.theme.must-be-canonical", "planner.theme.theme-zero-mandatory",
    "planner.theme.urn-namespace-matches", "planner.artifact-naming.theme-first-identity",
  ]);
  expect(implementationsFor(["planner"])).toEqual(["atdd_topology", "planner_plan_integrity", "planner_schema_validation", "planner_static_validators"]);
});

test("package plan-integrity diagnostics never impersonate canonical planner conventions", async () => {
  const fixture = join(root, "detectors/planner_plan_integrity/fixtures/dirty");
  const findings = await runImplementation("planner_plan_integrity", { scanRoots: [fixture], excludes: ["node_modules", ".git", ".atdd"] });
  // Every plan-integrity rule is exercised, and each reports under the package namespace, never a canonical id.
  expect([...new Set(findings.map(finding => finding.rule_id))].sort()).toEqual([
    "atdd-bun.planner.acceptance-identity", "atdd-bun.planner.identity-unique", "atdd-bun.planner.interlocking-participant-resolves",
    "atdd-bun.planner.parse", "atdd-bun.planner.reference-resolves", "atdd-bun.planner.train-wagon-resolves",
  ]);
});

test("the canonical train schema enforces typed train identities", async () => {
  const fixture = join(root, "detectors/planner_schema_validation/fixtures/dirty");
  const findings = await runImplementation("planner_schema_validation", { scanRoots: [fixture], excludes: ["node_modules", ".git", ".atdd"] });
  expect(findings.filter(finding => finding.rule_id === "planner.train.naming").map(finding => finding.evidence)).toContain('train violates train.schema.json: /train_id must match pattern "^train:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$"');
});
