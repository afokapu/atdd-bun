import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validatePlannerSchemas } from "../src/planner-schema-validator";
import { validateStaticPlannerConventions } from "../src/planner-validators";

async function write(root: string, path: string, content: string) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

const themes = `themes:
  "0": commons
  "1": orders
`;
const registry = `contracts:
  - identity: orders:placed
    path: contracts/orders/placed.schema.json
    theme: orders
    producers: [wagon:orders]
    consumers: []
`;
const wagon = (extra = "") => `wagon: orders
urn: wagon:orders
theme: orders
produce:
  - name: orders:placed
    contract: contract:orders:placed
    telemetry: telemetry:orders:placed
    to: external
consume: []
${extra}`;

async function fixture(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "atdd-theme-contract-"));
  const base = {
    "plan/_themes.yaml": themes,
    "contracts/_contracts.yaml": registry,
    "contracts/orders/placed.schema.json": '{"$id":"contract:orders:placed","type":"object"}\n',
    "plan/orders/_orders.yaml": wagon(),
    ...files,
  };
  await Promise.all(Object.entries(base).map(([path, content]) => write(root, path, content)));
  return root;
}

async function withFixture(files: Record<string, string>, assert: (root: string) => Promise<void>) {
  const root = await fixture(files);
  try { await assert(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("a repository-owned registry accepts arbitrary vocabulary while reserving commons at zero", async () => {
  await withFixture({}, async root => expect(await validateStaticPlannerConventions(root)).toEqual([]));
  await withFixture({ "plan/_themes.yaml": `themes:\n  "0": commons\n  "1": fulfilment\n`, "contracts/_contracts.yaml": registry.replaceAll("orders", "fulfilment"), "contracts/fulfilment/placed.schema.json": '{"type":"object"}', "plan/orders/_orders.yaml": wagon().replaceAll("orders", "fulfilment") }, async root => {
    expect(await validateStaticPlannerConventions(root)).toEqual([]);
  });
  await withFixture({ "contracts/_contracts.yaml": `contracts:\n  orders:placed:\n    path: contracts/orders/placed.schema.json\n    theme: orders\n    producers: [wagon:orders]\n    consumers: []\n` }, async root => {
    expect((await validatePlannerSchemas(root)).some(item => item.file === "contracts/_contracts.yaml")).toBeFalse();
    expect(await validateStaticPlannerConventions(root)).toEqual([]);
  });
});

test("theme validation rejects an absent registry, an invalid zero, duplicate names, and undeclared use", async () => {
  await withFixture({ "plan/_themes.yaml": "" }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.rule_id)).toContain("planner.theme.must-be-canonical"));
  await withFixture({ "plan/_themes.yaml": `themes:\n  "0": foundation\n  "1": orders\n` }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.rule_id)).toContain("planner.theme.theme-zero-mandatory"));
  await withFixture({ "plan/_themes.yaml": `themes:\n  "0": commons\n  "1": orders\n  "2": orders\n` }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.evidence)).toContain("theme orders is declared at more than one index"));
  await withFixture({ "plan/orders/_orders.yaml": wagon().replace("theme: orders", "theme: billing") }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.evidence)).toContain("theme billing is not declared in plan/_themes.yaml"));
});

test("theme validation rejects identity namespace drift", async () => {
  await withFixture({
    "plan/_themes.yaml": `themes:\n  "0": commons\n  "1": orders\n  "2": inventory\n`,
    "contracts/_contracts.yaml": registry.replaceAll("orders", "inventory"),
    "contracts/inventory/placed.schema.json": '{"type":"object"}',
    "plan/orders/_orders.yaml": wagon().replaceAll("orders:placed", "inventory:placed"),
  }, async root => {
    const rules = (await validateStaticPlannerConventions(root)).map(item => item.rule_id);
    expect(rules).toContain("planner.theme.urn-namespace-matches");
  });
});

test("contract registry validation covers resolution, null cross-wagon edges, unconsumed internal contracts, identity/theme drift, and paths", async () => {
  await withFixture({ "plan/orders/_orders.yaml": wagon().replaceAll("orders:placed", "orders:missing") }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.evidence).join("\n")).toContain("unregistered contract contract:orders:missing"));
  await withFixture({
    "plan/_themes.yaml": `themes:\n  "0": commons\n  "1": alpha\n  "2": beta\n`,
    "contracts/_contracts.yaml": "contracts: []\n",
    "plan/orders/_orders.yaml": `wagon: alpha\nurn: wagon:alpha\ntheme: alpha\nproduce:\n  - name: alpha:item\n    contract: null\n    telemetry: telemetry:alpha:item\nconsume: []\n`,
    "plan/beta/_beta.yaml": `wagon: beta\nurn: wagon:beta\ntheme: beta\nproduce: []\nconsume:\n  - name: alpha:item\n    from: wagon:alpha\n    contract: null\n`,
  }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.evidence).join("\n")).toContain("contract null but is consumed cross-wagon"));
  await withFixture({ "plan/orders/_orders.yaml": wagon().replace("to: external", "to: internal") }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.evidence).join("\n")).toContain("has no cross-wagon consumer and is not marked to: external"));
  await withFixture({ "contracts/_contracts.yaml": registry.replace("theme: orders", "theme: commons") }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.evidence).join("\n")).toContain("identity namespace is orders"));
  await withFixture({ "contracts/_contracts.yaml": registry.replace("placed.schema.json", "missing.schema.json") }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.evidence).join("\n")).toContain("points to missing"));
  await withFixture({ "contracts/_contracts.yaml": registry + "  - identity: orders:placed\n    path: contracts/orders/placed.schema.json\n    theme: orders\n    producers: [wagon:orders]\n    consumers: []\n" }, async root => expect((await validateStaticPlannerConventions(root)).map(item => item.evidence).join("\n")).toContain("declared more than once"));
});

test("shared schemas reject malformed registry documents with their canonical rule IDs", async () => {
  await withFixture({ "plan/_themes.yaml": `themes:\n  "0": foundation\n` }, async root => expect((await validatePlannerSchemas(root)).map(item => item.rule_id)).toContain("planner.theme.theme-zero-mandatory"));
  await withFixture({ "contracts/_contracts.yaml": "contracts:\n  - identity: orders:placed\n    theme: orders\n" }, async root => expect((await validatePlannerSchemas(root)).map(item => item.rule_id)).toContain("planner.contract.registry-coherence"));
});
