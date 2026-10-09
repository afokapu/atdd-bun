import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runImplementation } from "../src/enforce";

test("production-looking runner imports must resolve to consumer source", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-unresolved-production-"));
  try {
    await mkdir(join(root, "plan", "_trains", "_interlockings"), { recursive: true });
    await mkdir(join(root, "e2e", "interlockings"), { recursive: true });
    await writeFile(join(root, "plan", "_trains", "_interlockings", "route.yaml"), "interlocking_id: interlocking:proof\nroutes:\n  - route_id: nominal\n    train_id: train:proof:nominal\n");
    await writeFile(join(root, "plan", "_trains", "nominal.yaml"), "train_id: train:proof:nominal\nsequence:\n  - from: user:actor\n    to: wagon:first\n");
    await writeFile(join(root, "e2e", "interlockings", "lookalike.test.ts"), `import { expect, test } from "bun:test";
import { InterlockingRunner } from "../../src/does-not-exist-interlocking";
import { TrainRunner } from "../../src/does-not-exist-runner";
test("lookalike", () => { const resolution = new InterlockingRunner().resolveTrain("nominal", {}); const result = new TrainRunner(resolution.trainId).execute({}); expect(resolution.routeId).toBe("nominal"); expect(result.steps).toEqual([]); });
`);
    const findings = await runImplementation("bun_interlocking_coverage", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] });
    const ids = findings.map(finding => finding.rule_id);
    expect(ids).toContain("tester.bun.interlocking-production-runner-used");
    expect(ids).toContain("tester.bun.interlocking-route-coverage");
  } finally { await rm(root, { recursive: true, force: true }); }
});
