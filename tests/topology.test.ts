import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { enforce, runImplementation } from "../src/enforce";
import { validatePlan } from "../src/planner-kernel";

const fixture = (kind: "clean" | "dirty") => resolve(import.meta.dir, `../detectors/atdd_topology/fixtures/${kind}`);

test("topology closes wagon -> feature -> WMBT and binds configured source/test/E2E locations", async () => {
  expect(await runImplementation("atdd_topology", { scanRoots: [fixture("clean")], excludes: ["node_modules", ".git", ".atdd"] })).toEqual([]);
  const violations = await runImplementation("atdd_topology", { scanRoots: [fixture("dirty")], excludes: ["node_modules", ".git", ".atdd"] });
  const rules = new Set(violations.map(item => item.rule_id));
  expect(rules).toEqual(new Set([
    "planner.wagon.features",
    "planner.feature.wagon-link",
    "atdd-bun.topology.plan-location",
    "atdd-bun.topology.source-location",
    "atdd-bun.topology.test-location",
    "atdd-bun.topology.e2e-location",
    "atdd-bun.topology.feature-source-coverage",
    "atdd-bun.topology.feature-test-coverage",
  ]));
  expect(violations.some(item => item.file.endsWith("forged.ts") && item.evidence.includes("source requires URN"))).toBeTrue();
});

test("a configured plan root is shared by plan loading, traceability, tester acceptance resolution, and topology", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-topology-root-"));
  const write = async (path: string, content: string) => { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, content); };
  try {
    await write(join(root, "atdd-bun.yaml"), "topology:\n  plan_root: delivery-plan\n");
    await write(join(root, "delivery-plan/orders/_orders.yaml"), "urn: wagon:orders\nwmbt:\n  total: 1\nfeatures:\n  - urn: feature:orders:place-order\n");
    await write(join(root, "delivery-plan/orders/place-order.yaml"), "urn: feature:orders:place-order\nwagon: wagon:orders\nwmbts: [wmbt:orders:E001]\n");
    await write(join(root, "delivery-plan/orders/E001.yaml"), "urn: wmbt:orders:E001\nacceptances:\n  - identity:\n      urn: acc:orders:E001-UNIT-001\n");
    await write(join(root, "src/wagons/orders/features/place-order/domain/order.ts"), "// URN: component:orders:place-order:Order:backend:domain\n// Tested-By:\n// - test:orders:place-order:E001-UNIT-001\nexport class Order {}\n");
    await write(join(root, "tests/wagons/orders/features/place-order/unit/order.test.ts"), "// URN: test:orders:place-order:E001-UNIT-001\n// Acceptance: acc:orders:E001-UNIT-001\n// Phase: UNIT\n// Layer: domain\nimport { test } from 'bun:test';\ntest('order', () => {});\n");
    expect((await validatePlan(root)).artifacts.map(item => item.id)).toContain("feature:orders:place-order");
    expect(await enforce({ root, profiles: ["traceability", "tester", "topology"] })).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
