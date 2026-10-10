import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

// The consumer production shape (DOS Play toolkit-upgrade@992a5cc, read only): an exported async
// executeAction awaits JourneyRunner.execute into a const inside try, enriches the source execution
// through a ternary that returns the execution on both branches, and returns a typed failure from
// catch; stationMaster awaits executeAction("create_world"). JourneyRunner loops over declared hops
// and returns `...run.executed` from its terminal/continuation branches; InterlockingRunner returns a
// frozen { resolution, executed } record. The Station Master imports neither InterlockingRunner nor
// TrainRunner. Smoke drives executeAction directly and stationMaster -> executeAction.
const fixture = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage/fixtures/clean/journey_station_master_production_shape");
const scan = (implementation: string, root: string) => runImplementation(implementation, {
  scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"],
});
const both = async (root: string) => [...await scan("bun_interlocking_coverage", root), ...await scan("bun_interlocking_infrastructure", root)];
const ruleIds = (findings: Awaited<ReturnType<typeof both>>) => findings.map(finding => finding.rule_id);
const SMOKE = "tester.bun.interlocking-smoke-coverage-for-station-master";
const STATION = "coder.bun.station-master-interlocking-routing";
const JOURNEY = "coder.bun.station-master-journey-routing";

async function mutant(edit: (path: string, text: string) => string, file: string) {
  const root = await mkdtemp(join(tmpdir(), "atdd-station-production-shape-"));
  await cp(fixture, root, { recursive: true });
  const path = join(root, file);
  const before = await readFile(path, "utf8");
  const after = edit(path, before);
  expect(after).not.toBe(before);
  await writeFile(path, after);
  try {
    return await both(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const replace = (from: string, to: string) => (_path: string, text: string) => text.replace(from, to);

test("the consumer production Station Master shape clears both interlocking detector families", async () => {
  expect(await both(fixture)).toEqual([]);
});

const enriched = "return sourceRun ? { ...execution, source: sourceRun.result() } : execution;";
const negatives: Record<string, { file: string; from: string; to: string; rules: string[] }> = {
  "executeAction returns business data on the enrichment branch": {
    file: "src/server.ts", from: enriched,
    to: `return sourceRun ? { selectedTrainId: "train:source:refuse", source: sourceRun.result() } : execution;`,
    rules: [SMOKE, STATION, JOURNEY],
  },
  "executeAction awaits the journey but returns business data": {
    file: "src/server.ts", from: enriched,
    to: `void execution;\n    return { disposition: "INCOMPLETE_CONTINUATION" as const, status: 202 };`,
    rules: [SMOKE, STATION, JOURNEY],
  },
  "executeAction returns the execution only from a dead branch": {
    file: "src/server.ts", from: enriched,
    to: `if (false) return execution;\n    return { disposition: "INCOMPLETE_CONTINUATION" as const, status: 202 };`,
    rules: [SMOKE, STATION, JOURNEY],
  },
  "JourneyRunner terminal returns business data instead of the run": {
    file: "src/trains/journey.ts", from: "        ...run.executed,\n        journey: Object.freeze({ terminal,",
    to: "        selectedTrainId: \"train:source:refuse\", terminal: { artifact: \"x\", value: null }, wagons: [],\n        journey: Object.freeze({ terminal,",
    rules: [SMOKE, STATION],
  },
  "stationMaster delegates a different action": {
    file: "src/server.ts", from: `await executeAction("create_world", {`, to: `await executeAction("create_scenario", {`,
    rules: [SMOKE],
  },
  "stationMaster returns a response that ignores the execution": {
    file: "src/server.ts", from: "  return Response.json(sourceResult, {",
    to: "  void sourceResult;\n  return Response.json({ refusal: \"UNSUPPORTED_SOURCE_FORMAT\" }, {",
    rules: [SMOKE],
  },
};

for (const [name, { file, from, to, rules }] of Object.entries(negatives)) {
  test(`production-shape proof rejects: ${name}`, async () => {
    const found = ruleIds(await mutant(replace(from, to), file));
    for (const rule of rules) expect(found, rule).toContain(rule);
  });
}
