import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

// The consumer journey test shape (DOS Play e2e/journeys/*.journey.test.ts, read only): the test drives a declared
// journey through the production JourneyRunner, which composes InterlockingRunner -> TrainRunner, and asserts
// the JourneyRunner result. tester.bun.interlocking-production-runner-used accepts it only when the asserted value
// is bound to that execution and the journey-mediated chain is proven on the AST (lib/journey-chain.mjs).
const fixture = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage/fixtures/clean/journey_station_master_production_shape");
const RULE = "tester.bun.interlocking-production-runner-used";
const JOURNEY_TEST = "e2e/journeys/create-world-pack.journey.test.ts";

type Edit = { file: string; from: string; to: string };

async function productionRunnerFindings(edits: Edit[] = [], extra: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "atdd-runner-journey-"));
  await cp(fixture, root, { recursive: true });
  try {
    for (const { file, from, to } of edits) {
      const path = join(root, file);
      const before = await readFile(path, "utf8");
      const after = before.replace(from, to);
      expect(after, `${file}: ${from}`).not.toBe(before);
      await writeFile(path, after);
    }
    for (const [file, text] of Object.entries(extra)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    const findings = await runImplementation("bun_interlocking_coverage", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] });
    return findings.filter((finding) => finding.rule_id === RULE).map((finding) => finding.file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("production-runner-used accepts an asserted result of the proven production JourneyRunner", async () => {
  expect(await productionRunnerFindings()).toEqual([]);
});

const businessJourney = `{ selectedTrainId: "train:source:refuse", terminal: { artifact: "x", value: null }, wagons: [], journey: { outcome: "unsupported source refused", interlockings: ["interlocking:source-corpus-admission"] } }`;
const assertion = "  expect(result).toMatchObject({";

const negatives: Record<string, { edits?: Edit[]; extra?: Record<string, string> }> = {
  "the test imports and runs JourneyRunner but never asserts its result": {
    edits: [{ file: JOURNEY_TEST, from: assertion, to: "  void result;\n  expect(context).toMatchObject({" }],
  },
  "a same-named business literal in another test is asserted, not the JourneyRunner result": {
    edits: [{ file: JOURNEY_TEST, from: assertion, to: `  void result;\n});\n\ntest("business literal", () => {\n  const result = ${businessJourney};\n${assertion}` }],
  },
  "JourneyRunner terminal returns business data instead of the run": {
    edits: [{
      file: "src/trains/journey.ts",
      from: "        ...run.executed,\n        journey: Object.freeze({ terminal,",
      to: "        selectedTrainId: \"train:source:refuse\", terminal: { artifact: \"x\", value: null }, wagons: [],\n        journey: Object.freeze({ terminal,",
    }],
  },
  "JourneyRunner skips the InterlockingRunner": {
    edits: [{
      file: "src/trains/journey.ts",
      from: "const run = await new InterlockingRunner(path).execute(action, inputs, seed, context.handlers);",
      to: `void path;\n      const run = { resolution: { interlockingId: current, routeId: "refuse" }, executed: { selectedTrainId: "train:source:refuse", terminal: { artifact: "x", value: null }, wagons: [] as string[] } };`,
    }],
  },
  "a stub JourneyRunner declared in the test": {
    edits: [{
      file: JOURNEY_TEST,
      from: `import { JourneyRunner } from "../../src/trains/journey.ts";`,
      to: `class JourneyRunner {\n  constructor(readonly path: string) {}\n  async execute(..._args: unknown[]) { return ${businessJourney}; }\n}`,
    }],
  },
  "the test patches JourneyRunner.prototype.execute": {
    edits: [{
      file: JOURNEY_TEST,
      from: `import { testTrainContext } from "../support/production-train.ts";`,
      to: `import { testTrainContext } from "../support/production-train.ts";\n\nJourneyRunner.prototype.execute = async function () { return ${businessJourney} as any; };`,
    }],
  },
  "a non-production JourneyRunner stub module that never reaches the interlocking": {
    edits: [{ file: JOURNEY_TEST, from: `"../../src/trains/journey.ts"`, to: `"../support/journey-stub.ts"` }],
    extra: {
      "e2e/support/journey-stub.ts": `export class JourneyRunner {\n  constructor(readonly path: string) {}\n  async execute(..._args: unknown[]) { return ${businessJourney}; }\n}\n`,
    },
  },
  "the journey is not constructed from its declaration": {
    edits: [{ file: JOURNEY_TEST, from: `new JourneyRunner("plan/_journeys/create-world-pack.yaml")`, to: `new JourneyRunner("plan/_journeys/missing.yaml")` }],
  },
  "the executed action is not declared by the journey": {
    edits: [{ file: JOURNEY_TEST, from: `journey.execute("create_world",`, to: `journey.execute("create_scenario",` }],
  },
};

for (const [name, { edits, extra }] of Object.entries(negatives)) {
  test(`production-runner-used still fires: ${name}`, async () => {
    expect(await productionRunnerFindings(edits, extra)).toContain(JOURNEY_TEST);
  });
}
