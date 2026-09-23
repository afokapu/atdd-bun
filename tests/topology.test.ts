import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { runImplementation } from "../src/enforce";

const fixture = (kind: "clean" | "dirty") => resolve(import.meta.dir, `../detectors/atdd_topology/fixtures/${kind}`);

test("topology closes wagon -> feature -> WMBT and binds configured source/test/E2E locations", async () => {
  expect(await runImplementation("atdd_topology", { scanRoots: [fixture("clean")], excludes: ["node_modules", ".git", ".atdd"] })).toEqual([]);
  const rules = new Set((await runImplementation("atdd_topology", { scanRoots: [fixture("dirty")], excludes: ["node_modules", ".git", ".atdd"] })).map(item => item.rule_id));
  expect(rules).toEqual(new Set([
    "planner.wagon.features",
    "planner.feature.wagon-link",
    "atdd-bun.topology.plan-location",
    "atdd-bun.topology.source-location",
    "atdd-bun.topology.test-location",
    "atdd-bun.topology.e2e-location",
  ]));
});
