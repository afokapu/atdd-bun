import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validatePlannerSchemas } from "../src/planner-schema-validator";

async function write(root: string, path: string, content: string) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

test("the planner profile uses canonical schemas for every recognized artifact kind", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-schema-"));
  try {
    await write(root, "plan/orders/_orders.yaml", "wagon: orders\nurn: wagon:orders\ndescription: A valid order wagon.\nsubject: agent:planner\ncontext: test\naction: order\ngoal: validate\noutcome: validated\nproduce:\n  - name: orders:placed\n    contract: contract:orders:placed\n    telemetry: telemetry:orders:placed\nconsume: []\nwmbt:\n  total: 1\n");
    await write(root, "plan/orders/features/place-order.yaml", "urn: feature:orders:place-order\nwagon: wagon:orders\ndescription: A valid order feature.\nsizing:\n  wmbts: 1\n  footprint_score: 1\n  footprint_size: S\nwmbts: [wmbt:orders:E001]\ncomponents:\n  backend:\n    application:\n      - type: use_cases\n        count: 1\n        rationale: Places one validated order.\n");
    await write(root, "plan/orders/E001.yaml", "urn: wmbt:orders:E001\nstep: execute\ndirection: maximize\ndimension: likelihood\nobject_of_control: order\nlens: functional.effectiveness\nacceptances:\n  - identity:\n      urn: acc:orders:E001-SMOKE-001\n      id: AC-SMOKE-001\n      purpose: Verify the order is placed.\n      phase: SMOKE\n    harness:\n      type: smoke\n      category: integration\n    given:\n      abstract: [An order request exists]\n    when:\n      abstract: The order is submitted\n    then:\n      abstract: [The order is placed]\n");
    await write(root, "plan/_trains/orders.yaml", "train_id: train:orders:checkout\ntitle: Checkout journey\ndescription: A valid checkout journey.\nthemes: [orders]\nparticipants: [wagon:orders]\nsequence:\n  - step: 1\n    intent: Place the order\n    from: wagon:orders\n    to: wagon:orders\n    artifact: orders:placed\n");
    await write(root, "plan/_trains/_interlockings/orders.yaml", "schema_version: 1.0.0\ninterlocking_id: interlocking:orders\ntitle: Order routing\ntheme: orders\nstatus: checked\nsource:\n  path: plan/_trains/_interlockings/orders.yaml\n  content_digest: digest\nentrypoint:\n  exposed: false\n  actions: []\n  reason: internal-transition-only\n  surfaces: [backend]\nroute_resolution:\n  strategy: fail_on_multiple_match\nlifelines:\n  - ref: wagon:orders\nmessages: []\nroutes:\n  - route_id: nominal\n    category: nominal\n    priority: 1\n    guard_ref: guard:nominal\n    train_id: train:orders:checkout\n    train_path: plan/_trains/orders.yaml\n    projection:\n      expected_sequence_digest: digest\n");
    expect(await validatePlannerSchemas(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema diagnostics identify the schema-owned field and do not duplicate its rule", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-bun-schema-"));
  try {
    await write(root, "plan/_trains/orders.yaml", "train_id: 1001-checkout\ntitle: Checkout journey\ndescription: A deliberately invalid identity.\nthemes: [orders]\nparticipants: [wagon:orders]\nsequence:\n  - step: 1\n    intent: Place the order\n    from: wagon:orders\n    to: wagon:orders\n    artifact: orders:placed\n");
    const findings = await validatePlannerSchemas(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule_id).toBe("planner.train.naming");
    expect(findings[0].evidence).toContain("train.schema.json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
