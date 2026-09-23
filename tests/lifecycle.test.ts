import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runImplementation } from "../src/enforce";
import { formatPlannedDebt, loadLifecycle, plannedDebt } from "../src/lifecycle";

// Staged activation, adversarially: planned scope is explicitly non-executable, and nothing else loosens.
// Each case builds a throwaway repository, so every assertion is about the lifecycle rule alone.

const repo = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "atdd-lifecycle-"));
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  return root;
};
const run = async (implementation: string, root: string) => (await runImplementation(implementation, { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] }))
  .map(v => `${v.rule_id} ${v.file.startsWith(root) ? v.file.slice(root.length + 1) : v.file}`).sort();
const traceability = (root: string) => run("atdd_traceability_closure", root);

const feature = (slug: string, status: string | null, wmbts: string[]) =>
  `urn: feature:orders:${slug}\nwagon: wagon:orders\n${status === null ? "" : `status: ${status}\n`}wmbts: [${wmbts.join(", ")}]\n`;
const wmbt = (code: string, ...acceptances: string[]) =>
  `urn: wmbt:orders:${code}\nacceptances:\n${acceptances.map(a => `  - identity:\n      urn: acc:orders:${code}-UNIT-${a}\n`).join("")}`;
const bound = (acceptance: string) => `// URN: test:orders:x:${acceptance.slice("acc:orders:".length)}\n// Acceptance: ${acceptance}\nimport { test } from "bun:test";\ntest("x", () => {});\n`;
const source = (feature: string, tests: string[]) => `// URN: component:orders:${feature}:Thing:backend:domain\n${tests.length ? `// Tested-By:\n${tests.map(t => `// - ${t}\n`).join("")}` : ""}export const thing = 1;\n`;

test("a planned feature's acceptance may lack a test: it is planned debt, not a closure violation", async () => {
  const root = await repo({ "plan/orders/a.yaml": feature("a", "planned", ["wmbt:orders:E001"]), "plan/orders/E001.yaml": wmbt("E001", "001", "002") });
  expect(await traceability(root)).toEqual([]);
  expect(plannedDebt(await loadLifecycle(root)).plannedAcceptances.map(a => a.acceptance)).toEqual(["acc:orders:E001-UNIT-001", "acc:orders:E001-UNIT-002"]);
});

test("with no status anywhere, closure is exactly as strict as before lifecycles existed", async () => {
  const root = await repo({ "plan/orders/a.yaml": feature("a", null, ["wmbt:orders:E001"]), "plan/orders/E001.yaml": wmbt("E001", "001") });
  expect(await traceability(root)).toEqual(["traceability.plan.executable-acceptance-has-test plan/"]);
});

test("an acceptance no feature owns stays executable even when other features are planned", async () => {
  const root = await repo({ "plan/orders/a.yaml": feature("a", "planned", ["wmbt:orders:E001"]), "plan/orders/E001.yaml": wmbt("E001", "001"), "plan/orders/E002.yaml": wmbt("E002", "001") });
  expect(await traceability(root)).toEqual(["traceability.plan.executable-acceptance-has-test plan/"]);
});

test("a malformed planned plan still fails structural validation; status is never a structural exemption", async () => {
  // Missing description, sizing and components, and an out-of-vocabulary status on a sibling.
  const root = await repo({ "plan/orders/a.yaml": feature("a", "planned", ["wmbt:orders:E001"]), "plan/orders/b.yaml": feature("b", "someday", []), "plan/orders/E001.yaml": wmbt("E001", "001") });
  const schema = await run("planner_schema_validation", root);
  expect(schema.some(f => f.endsWith("plan/orders/a.yaml"))).toBeTrue();
  expect(schema.some(f => f.endsWith("plan/orders/b.yaml"))).toBeTrue();
  expect(await traceability(root)).toContain("traceability.lifecycle.status-valid plan/orders/b.yaml");
});

test("activating a feature without every acceptance bound fails closure", async () => {
  const root = await repo({ "plan/orders/a.yaml": feature("a", "tested", ["wmbt:orders:E001"]), "plan/orders/E001.yaml": wmbt("E001", "001", "002"), "test/one.test.ts": bound("acc:orders:E001-UNIT-001") });
  const findings = await traceability(root);
  expect(findings).toEqual(["traceability.plan.executable-acceptance-has-test plan/"]);
  expect((await runImplementation("atdd_traceability_closure", { scanRoots: [root], excludes: [] }))[0].evidence).toContain("acc:orders:E001-UNIT-002");
  // Complete closure: the same activation passes.
  await writeFile(join(root, "test/two.test.ts"), bound("acc:orders:E001-UNIT-002"));
  expect(await traceability(root)).toEqual([]);
});

test("a planned feature may carry partial source with a valid Tested-By; malformed or unresolved Tested-By still fails", async () => {
  // One of two acceptances is tested and the source for it exists: partial progress inside planned scope.
  const files = {
    "plan/orders/a.yaml": feature("a", "planned", ["wmbt:orders:E001"]), "plan/orders/E001.yaml": wmbt("E001", "001", "002"),
    "test/one.test.ts": bound("acc:orders:E001-UNIT-001"), "src/thing.ts": source("a", ["test:orders:x:E001-UNIT-001"]),
  };
  expect(await traceability(await repo(files))).toEqual([]);
  // A Tested-By header with no well-formed `- test:` entry, and one naming a test that does not exist.
  const malformed = "// URN: component:orders:a:Malformed:backend:domain\n// Tested-By:\n// - tst:orders:x:E001-UNIT-001\nexport const m = 1;\n";
  const root = await repo({ ...files, "src/malformed.ts": malformed, "src/ghost.ts": source("a", ["test:orders:x:E001-UNIT-002"]) });
  expect(await traceability(root)).toEqual(["traceability.source.tested-by-present src/malformed.ts", "traceability.source.tested-by-resolves src/ghost.ts"]);
});

test("an implemented feature needs component source; a tested one does not yet", async () => {
  const files = { "plan/orders/E001.yaml": wmbt("E001", "001"), "test/one.test.ts": bound("acc:orders:E001-UNIT-001") };
  expect(await traceability(await repo({ ...files, "plan/orders/a.yaml": feature("a", "implemented", ["wmbt:orders:E001"]) }))).toEqual(["traceability.lifecycle.implemented-feature-has-source plan/orders/a.yaml"]);
  expect(await traceability(await repo({ ...files, "plan/orders/a.yaml": feature("a", "tested", ["wmbt:orders:E001"]) }))).toEqual([]);
});

test("once statuses are declared, an acceptance shared by two features is rejected, never silently planned", async () => {
  const root = await repo({ "plan/orders/a.yaml": feature("a", "planned", ["wmbt:orders:E001"]), "plan/orders/b.yaml": feature("b", "planned", ["wmbt:orders:E001"]), "plan/orders/E001.yaml": wmbt("E001", "001") });
  expect(await traceability(root)).toEqual(["traceability.lifecycle.acceptance-single-owner plan/orders/E001.yaml", "traceability.plan.executable-acceptance-has-test plan/"]);
});

test("a planned train may lack an end-to-end binding; a tested or implemented one may not", async () => {
  const train = (status: string) => ({ "plan/_trains/checkout.yaml": `train_id: train:orders:checkout\nstatus: ${status}\nparticipants: [user:shopper]\n` });
  expect(await traceability(await repo(train("planned")))).toEqual([]);
  for (const status of ["tested", "implemented"]) expect(await traceability(await repo(train(status)))).toEqual(["traceability.train.executable-train-has-test plan/_trains/checkout.yaml"]);
  const covered = await repo({ ...train("tested"), "test/checkout.test.ts": "// URN: test:orders:checkout:E2E-001-go\n// Train: train:orders:checkout\nimport { test } from \"bun:test\";\ntest(\"x\", () => {});\n" });
  expect(await traceability(covered)).toEqual([]);
});

test("a planned human-facing train owes no browser spec; an activated one does", async () => {
  const train = (status: string) => repo({ "plan/_trains/checkout.yaml": `train_id: train:orders:checkout\nstatus: ${status}\nparticipants: [user:shopper, wagon:orders]\n` });
  const coverage = async (status: string) => (await run("htmx_e2e_detector", await train(status))).filter(f => f.startsWith("tester.htmx.train-e2e-coverage"));
  expect(await coverage("planned")).toEqual([]);
  expect(await coverage("tested")).toEqual(["tester.htmx.train-e2e-coverage plan/_trains/checkout.yaml"]);
});

test("an interlocking route that selects a planned train owes no route test; an activated one does", async () => {
  const interlocking = "interlocking_id: interlocking:checkout\nstatus: checked\nroutes:\n  - route_id: nominal\n    category: nominal\n    train_id: train:orders:checkout\n";
  const at = (status: string) => repo({ "plan/_trains/checkout.yaml": `train_id: train:orders:checkout\nstatus: ${status}\n`, "plan/_trains/_interlockings/checkout.yaml": interlocking });
  const routes = async (implementation: string, rule: string, status: string) => (await run(implementation, await at(status))).filter(f => f.startsWith(rule));
  expect(await routes("bun_interlocking_coverage", "tester.bun.interlocking-route-coverage", "planned")).toEqual([]);
  expect(await routes("bun_interlocking_coverage", "tester.bun.interlocking-route-coverage", "tested")).toHaveLength(1);
  expect(await routes("atdd_topology", "atdd-bun.topology.e2e-location", "planned")).toEqual([]);
  expect(await routes("atdd_topology", "atdd-bun.topology.e2e-location", "tested")).toHaveLength(1);
});

test("component source Tested-By stays strict whatever the feature's status", async () => {
  for (const status of ["planned", "tested", "implemented", null]) {
    const root = await repo({ "plan/orders/a.yaml": feature("a", status, ["wmbt:orders:E001"]), "plan/orders/E001.yaml": wmbt("E001", "001"), "test/one.test.ts": bound("acc:orders:E001-UNIT-001"), "src/bare.ts": source("a", []), "src/ghost.ts": source("a", ["test:orders:x:E001-UNIT-404"]) });
    const findings = await traceability(root);
    expect(findings, String(status)).toContain("traceability.source.tested-by-present src/bare.ts");
    expect(findings, String(status)).toContain("traceability.source.tested-by-resolves src/ghost.ts");
  }
});

test("orphan and unknown bindings fail even when they point into planned scope", async () => {
  const root = await repo({
    "plan/orders/a.yaml": feature("a", "planned", ["wmbt:orders:E001"]), "plan/orders/E001.yaml": wmbt("E001", "001"),
    "test/planned.test.ts": bound("acc:orders:E001-UNIT-001"), // binds a planned acceptance: allowed, and resolves
    "test/orphan.test.ts": bound("acc:orders:E001-UNIT-404"),
    "test/train.test.ts": "// URN: test:orders:x:E2E-001-go\n// Train: train:orders:nowhere\n",
    "test/unbound.test.ts": "// URN: test:orders:x:E001-UNIT-001\n// Acceptance: not-a-plan-id\n",
  });
  expect(await traceability(root)).toEqual(["traceability.test.binding-resolves test/orphan.test.ts", "traceability.test.binding-resolves test/train.test.ts", "traceability.test.binding-resolves test/unbound.test.ts"]);
});

test("a train-parented acceptance follows its train's lifecycle", async () => {
  const plan = (status: string) => repo({ "plan/_trains/checkout.yaml": `train_id: train:orders:checkout\nstatus: ${status}\n`, "plan/_trains/checkout.acc.yaml": "urn: acc:train:orders:checkout:pays\nid: AC-E2E-001\n" });
  expect(await traceability(await plan("planned"))).toEqual([]);
  expect(await traceability(await plan("tested"))).toEqual(["traceability.plan.executable-acceptance-has-test plan/", "traceability.train.executable-train-has-test plan/_trains/checkout.yaml"]);
});

test("an acceptance embedded in a planned train is planned debt, and counted as such", async () => {
  const embedded = "acceptances:\n  - identity:\n      urn: acc:train:orders:checkout:pays\n";
  const plan = (status: string) => repo({ "plan/_trains/checkout.yaml": `train_id: train:orders:checkout\nstatus: ${status}\n${embedded}` });
  const planned = await plan("planned");
  expect(await traceability(planned)).toEqual([]);
  expect(plannedDebt(await loadLifecycle(planned)).plannedAcceptances).toEqual([{ acceptance: "acc:train:orders:checkout:pays", owner: "train:orders:checkout" }]);
  expect(await traceability(await plan("tested"))).toEqual(["traceability.plan.executable-acceptance-has-test plan/", "traceability.train.executable-train-has-test plan/_trains/checkout.yaml"]);
});

test("the planned-debt report is deterministic: identical for identical plans, whatever the write order", async () => {
  const files: Record<string, string> = {
    "plan/orders/b.yaml": feature("b", "planned", ["wmbt:orders:E002"]), "plan/orders/a.yaml": feature("a", "planned", ["wmbt:orders:E001"]), "plan/orders/c.yaml": feature("c", "tested", ["wmbt:orders:E003"]),
    "plan/orders/E002.yaml": wmbt("E002", "002", "001"), "plan/orders/E001.yaml": wmbt("E001", "001"), "plan/orders/E003.yaml": wmbt("E003", "001"),
    // File names sort opposite to train ids, so only an explicit sort orders the report by id.
    "plan/_trains/a.yaml": "train_id: train:orders:z\nstatus: planned\n", "plan/_trains/b.yaml": "train_id: train:orders:y\nstatus: planned\n",
  };
  const forward = await repo(files), backward = await repo(Object.fromEntries(Object.entries(files).reverse()));
  const [one, two, three] = await Promise.all([forward, forward, backward].map(async root => plannedDebt(await loadLifecycle(root))));
  expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  expect(JSON.stringify(one)).toBe(JSON.stringify(three));
  expect(formatPlannedDebt(one)).toBe([
    "features: planned 2, tested 1, implemented 0, undeclared 0, invalid 0",
    "trains: planned 2, tested 0, implemented 0, undeclared 0, invalid 0",
    "planned acceptances: 3",
    "  acc:orders:E001-UNIT-001 (feature:orders:a)",
    "  acc:orders:E002-UNIT-001 (feature:orders:b)",
    "  acc:orders:E002-UNIT-002 (feature:orders:b)",
    "planned trains: 2",
    "  train:orders:y",
    "  train:orders:z",
  ].join("\n"));
});
