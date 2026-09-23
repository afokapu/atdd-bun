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
