// URN: test:toolkit:test-traceability:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runImplementation } from "../src/enforce";

test("an acceptance catalog resolves a newly identified test", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-test-file-traceability-"));
  const files = {
    "plan/toolkit/acceptances.yaml": `acceptances:
  - identity:
      urn: acc:toolkit:E001-UNIT-001-bound-test-file
`,
    "tests/new.test.ts": `// URN: test:toolkit:test-traceability:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
test("is bound", () => expect(true).toBe(true));
`,
  };
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    const findings = [
      ...await runImplementation("atdd_traceability_closure", { scanRoots: [root], excludes: [] }),
      ...await runImplementation("bun_tester_discipline_detector", { scanRoots: [root], excludes: [] }),
    ];
    expect(findings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
