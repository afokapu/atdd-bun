import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runImplementation } from "../src/enforce";

// Traceability closure holes: each case is a way a test or source file could look traced while it is not.
const repo = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "atdd-trace-"));
  for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  return root;
};
const findings = async (root: string) => (await runImplementation("atdd_traceability_closure", { scanRoots: [root], excludes: ["node_modules", ".git"] }))
  .map(v => `${v.rule_id} ${v.file.startsWith(root) ? v.file.slice(root.length + 1) : v.file}`).sort();
const WMBT = "urn: wmbt:orders:E001\nacceptances:\n  - identity:\n      urn: acc:orders:E001-UNIT-001\n";
const BOUND = "// URN: test:orders:x:E001-UNIT-001\n// Acceptance: acc:orders:E001-UNIT-001\n";

test("every binding header must resolve, not only the first", async () => {
  const root = await repo({
    "plan/orders/E001.yaml": WMBT,
    "test/two.test.ts": `${BOUND}// Train: train:orders:does-not-exist\n`,
    "test/bad.test.ts": "// URN: test:orders:x:E001-UNIT-002\n// Acceptance: acc:orders:E001-UNIT-001\n// WMBT: not-a-wmbt\n",
  });
  expect(await findings(root)).toEqual(["traceability.test.binding-resolves test/bad.test.ts", "traceability.test.binding-resolves test/two.test.ts"]);
});

test("an acceptance without a test is reported where it is declared", async () => {
  const root = await repo({ "plan/orders/E001.yaml": WMBT });
  const [finding] = await runImplementation("atdd_traceability_closure", { scanRoots: [root], excludes: [] });
  expect([finding.rule_id, finding.file, finding.line]).toEqual(["traceability.plan.executable-acceptance-has-test", join(root, "plan/orders/E001.yaml"), 4]);
});

test("a plan at the repository root (plan_root: .) is judged", async () => {
  for (const planRoot of [".", "./"]) {
    const root = await repo({ "atdd-bun.yaml": `topology:\n  plan_root: ${planRoot}\n`, "E001.yaml": WMBT });
    expect(await findings(root), planRoot).toEqual(["traceability.plan.executable-acceptance-has-test E001.yaml"]);
  }
});

test("a Tested-By entry counts only under a Tested-By header, and every entry is judged", async () => {
  const root = await repo({
    "plan/orders/E001.yaml": WMBT, "test/one.test.ts": BOUND,
    "src/stray.ts": "// URN: component:orders:a:Stray:backend:domain\n// - test:orders:x:E001-UNIT-001\nexport const s = 1;\n",
    "src/mixed.ts": "// URN: component:orders:a:Mixed:backend:domain\n// Tested-By:\n// - test:orders:x:E001-UNIT-001\n// - not-a-test\nexport const m = 1;\n",
    "src/good.ts": "// URN: component:orders:a:Good:backend:domain\n// Tested-By:\n// - test:orders:x:E001-UNIT-001\nexport const g = 1;\n",
  });
  expect(await findings(root)).toEqual(["traceability.source.tested-by-present src/stray.ts", "traceability.source.tested-by-resolves src/mixed.ts"]);
});
