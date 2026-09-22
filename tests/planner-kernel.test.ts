import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { traceabilityPlan, validatePlan } from "../src/planner-kernel";

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "atdd-planner-kernel-"));
  await Promise.all(Object.entries(files).map(async ([path, content]) => { const file = join(root, path); await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, content); }));
  return root;
}

const wagon = `wagon: fulfil-order\nurn: wagon:fulfil-order\ndescription: A sufficiently long description\nsubject: agent:planner\ncontext: test\naction: fulfil\ngoal: verify\noutcome: verified\nproduce: []\nconsume: []\nwmbt:\n  total: 1\nfeatures:\n  - urn: feature:fulfil-order:book\n`;

async function countFiles(root: string, suffix: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? countFiles(join(root, entry.name), suffix) : Promise.resolve(entry.name.endsWith(suffix) ? 1 : 0)))).reduce((sum, value) => sum + value, 0);
}

test("planner package assets contain canonical nodes and schemas, never raw Python validators", async () => {
  const root = join(import.meta.dir, "..");
  expect(await countFiles(join(root, "planner-nodes/nodes"), ".yaml")).toBe(195);
  expect(await countFiles(join(root, "planner-schemas"), ".json")).toBe(21);
  expect(await countFiles(root, ".py")).toBe(0);
});

test("the static kernel joins wagon, feature, WMBT, acceptance, train, interlocking, and journey", async () => {
  const root = await fixture({
    "plan/fulfil_order/_fulfil_order.yaml": wagon,
    "plan/fulfil_order/features/book.yaml": "urn: feature:fulfil-order:book\nwagon: wagon:fulfil-order\nwmbts: [wmbt:fulfil-order:E001]\n",
    "plan/fulfil_order/E001.yaml": "urn: wmbt:fulfil-order:E001\nstep: execute\ndirection: maximize\ndimension: likelihood\nobject_of_control: order\nlens: functional.effectiveness\nacceptances:\n  - identity:\n      urn: acc:fulfil-order:E001-UNIT-001\n",
    "plan/_trains/fulfilment/run.yaml": "train_id: train:fulfilment:run\nparticipants: [wagon:fulfil-order]\nsource_interlocking:\n  interlocking_id: interlocking:fulfilment\n",
    "plan/_trains/_interlockings/fulfilment.yaml": "interlocking_id: interlocking:fulfilment\nlifelines:\n  - ref: wagon:fulfil-order\nroutes:\n  - train_id: train:fulfilment:run\nmessages:\n  - from: wagon:fulfil-order\n    to: wagon:fulfil-order\n    wmbt_refs: [wmbt:fulfil-order:E001]\n",
    "plan/_journeys/fulfilment.yaml": "journey_id: journey:fulfilment\nentrypoint:\n  interlocking_id: interlocking:fulfilment\ncontinuations: []\nterminals:\n  - from:\n      interlocking_id: interlocking:fulfilment\n      route_id: run\n    outcome: completed\n",
  });
  try { const graph = await validatePlan(root); expect(graph.findings).toEqual([]); expect(graph.artifacts.map(a => a.kind).sort()).toEqual(["acceptance", "feature", "interlocking", "journey", "train", "wagon", "wmbt"]); expect(traceabilityPlan(graph)).toContainEqual({ from: "wmbt:fulfil-order:E001", to: "acc:fulfil-order:E001-UNIT-001", relation: "defines" }); expect(traceabilityPlan(graph)).toContainEqual({ from: "journey:fulfilment", to: "interlocking:fulfilment", relation: "references" }); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("the kernel rejects parse, identity, graph, train, interlocking, and acceptance faults", async () => {
  const root = await fixture({
    "plan/a/_a.yaml": wagon,
    "plan/b/_b.yaml": wagon,
    "plan/a/features/bad.yaml": "urn: feature:fulfil-order:book\nwagon: wagon:missing\nwmbts: [wmbt:missing:E001]\n",
    "plan/a/E001.yaml": "urn: wmbt:fulfil-order:E001\nacceptances: [not-an-object]\n",
    "plan/_trains/bad/run.yaml": "train_id: train:bad:run\nwagons: [missing]\nparticipants: [wagon:missing]\n",
    "plan/_trains/_interlockings/bad.yaml": "interlocking_id: interlocking:bad\nlifelines: [{ ref: wagon:missing }]\n",
    "plan/a/broken.yaml": "invalid: [yaml\n",
  });
  try { const rules = new Set((await validatePlan(root)).findings.map(f => f.rule_id)); expect(rules).toEqual(new Set(["planner.kernel.parse", "planner.kernel.identity-unique", "planner.kernel.reference-resolves", "planner.kernel.train-wagon-resolves", "planner.kernel.interlocking-participant-resolves", "planner.kernel.acceptance-well-formed"])); }
  finally { await rm(root, { recursive: true, force: true }); }
});
