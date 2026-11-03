// URN: test:toolkit:journey-entry-object-form-dataflow:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

// Object-form JourneyEntry dataflow (Decision response-request 493699cb and response-retrieval 480bf229, read only):
//   const entry = stationMaster.JOURNEY_MAP[ACTION];
//   const journey = new JourneyRunner(entry.path, runtime);
//   const result = await journey.execute({ journeyId: entry.journeyId, interlockingId: entry.interlockingId, action: ACTION, executionKey, inputs }, ctx);
//   expect(result.<member chain>).toEqual(expected);
// tester.bun.interlocking-production-runner-used must accept it only when the journey path statically resolves
// through a const object-literal JOURNEY_MAP (test-local, or exported by a local production module) to a repository
// journey declaration that declares the executed action. Anything dynamic, overridden or unasserted stays a finding.
const fixture = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage/fixtures/clean/journey_station_master_production_shape");
const RUNNER = "tester.bun.interlocking-production-runner-used";
const JOURNEY_TEST = "e2e/journeys/object-form.journey.test.ts";
const SERVER = "src/server.ts";
const JOURNEY_RUNNER = "src/trains/journey.ts";

type Edit = { file: string; from: string; to: string };

const entryRequest = `{
    journeyId: entry.journeyId,
    interlockingId: entry.interlockingId,
    action: ACTION,
    executionKey: "execution:object-form",
    inputs: { source: { required_supported: false } },
  }`;

// Written into each scanned copy rather than persisted in the fixture, so the corpus adds no test file.
const journeyTest = (head = `import * as stationMaster from "../../src/server.ts";`, lookup = "stationMaster.JOURNEY_MAP[ACTION]") => `// Phase: E2E
// Object-form JourneyEntry shape: the production JourneyRunner is built from the mapped journey path and executed
// with the object-form request; the asserted value is the awaited execution result.
import { expect, test } from "bun:test";
${head}
import { JourneyRunner } from "../../src/trains/journey.ts";
import { testTrainContext } from "../support/production-train.ts";

const ACTION = "create_world";
const runtime = { clock: "fixed" };

test("create_world reaches the declared source refusal terminal through the mapped production JourneyRunner", async () => {
  const entry = ${lookup};
  const journey = new JourneyRunner(entry.path, runtime);
  const context = await testTrainContext("plan/_trains/train:source:refuse.yaml");
  const result = await journey.execute(${entryRequest}, {
    initialArtifacts: context.seed,
    handlers: context.handlers,
  });
  expect(result.journey?.interlockings).toEqual(["interlocking:source-corpus-admission"]);
});
`;

const localMap = `const JOURNEY_MAP = {
  create_world: {
    journeyId: "journey:create-world-pack",
    path: "plan/_journeys/create-world-pack.yaml",
    interlockingId: "interlocking:source-corpus-admission",
  },
} as const;`;

// The copy's production JourneyRunner takes the object-form request and the runtime second constructor argument.
const objectFormRunner: Edit[] = [
  {
    file: JOURNEY_RUNNER,
    from: "constructor(private readonly journeyYamlPath: string) {}",
    to: "constructor(private readonly journeyYamlPath: string, _runtime?: unknown) {}",
  },
  {
    file: JOURNEY_RUNNER,
    from: "async execute(action: string, inputs: Record<string, unknown>, context: ExecutionContext): Promise<JourneyExecution> {",
    to: "async execute(request: Readonly<{ action: string; inputs: Record<string, unknown> }>, context: ExecutionContext): Promise<JourneyExecution> {\n    const { action, inputs } = request;",
  },
];

async function findings(test: string, edits: Edit[] = [], extra: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "atdd-journey-entry-"));
  try {
    await cp(fixture, root, { recursive: true });
    await mkdir(dirname(join(root, JOURNEY_TEST)), { recursive: true });
    await writeFile(join(root, JOURNEY_TEST), test);
    for (const { file, from, to } of [...objectFormRunner, ...edits]) {
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
    const all = await runImplementation("bun_interlocking_coverage", { scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"] });
    return all.filter((finding) => finding.rule_id === RUNNER).map((finding) => finding.file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const positives: Record<string, string> = {
  "namespace import of the exported local JOURNEY_MAP": journeyTest(),
  "named import of the exported local JOURNEY_MAP": journeyTest(`import { JOURNEY_MAP } from "../../src/server.ts";`, "JOURNEY_MAP[ACTION]"),
  "a literal map key": journeyTest(undefined, `stationMaster.JOURNEY_MAP["create_world"]`),
  "a test-local const JOURNEY_MAP": journeyTest(localMap, "JOURNEY_MAP[ACTION]"),
};

for (const [name, text] of Object.entries(positives)) {
  test(`production-runner-used accepts the object-form JourneyEntry: ${name}`, async () => {
    expect(await findings(text)).toEqual([]);
  });
}

const edit = (from: string, to: string, file = JOURNEY_TEST): Edit => ({ file, from, to });
const MAP_DECLARATION = "export const JOURNEY_MAP: Readonly<Record<string, StationRoute>> = {";
const MAP_END = "};\n\nconst unavailableWagonHandlers";
const base = journeyTest();

const negatives: Record<string, { text?: string; edits?: Edit[]; extra?: Record<string, string> }> = {
  "the entry is a reassignable let": { edits: [edit("const entry =", "let entry =")] },
  "the action key is a reassignable let": { edits: [edit(`const ACTION = "create_world";`, `let ACTION = "create_world";`)] },
  "the action key is dynamic": {
    edits: [edit(`const ACTION = "create_world";`, `const ACTION = (process.argv[2] ?? "create_world") as keyof typeof stationMaster.JOURNEY_MAP;`)],
  },
  "the entry is not read from the map": {
    edits: [edit("const entry = stationMaster.JOURNEY_MAP[ACTION];", `const entry = { journeyId: "journey:create-world-pack", path: String(process.argv[2]), interlockingId: "interlocking:source-corpus-admission" };`)],
  },
  "the path is overridden by a dynamic value": {
    edits: [edit("new JourneyRunner(entry.path, runtime)", "new JourneyRunner(process.env.JOURNEY_PATH ?? entry.path, runtime)")],
  },
  "the path is a different map field": {
    edits: [edit("new JourneyRunner(entry.path, runtime)", "new JourneyRunner(entry.journeyId, runtime)")],
  },
  "the map is imported from a package, not a local production module": {
    edits: [edit(`"../../src/server.ts"`, `"@scope/station-master"`)],
  },
  "the map is a let": { edits: [edit(MAP_DECLARATION, MAP_DECLARATION.replace("export const", "export let"), SERVER)] },
  "the map is built by a function": {
    edits: [
      edit(MAP_DECLARATION, MAP_DECLARATION.replace("= {", "= build({"), SERVER),
      edit(MAP_END, MAP_END.replace("};", "});"), SERVER),
      edit("const unavailableWagonHandlers: WagonHandlerRegistry = {};", "function build<T>(map: T): T {\n  return map;\n}\n\nconst unavailableWagonHandlers: WagonHandlerRegistry = {};", SERVER),
    ],
  },
  "the map spreads another object": {
    edits: [edit(MAP_DECLARATION, `${MAP_DECLARATION}\n  ...({} as Record<string, StationRoute>),`, SERVER)],
  },
  "the map entry is reassigned after declaration": {
    edits: [edit(MAP_END, `${MAP_END.slice(0, 2)}\n\n(JOURNEY_MAP as Record<string, StationRoute>).create_world = { journeyId: "journey:create-world-pack", path: "plan/_journeys/missing.yaml", interlockingId: "interlocking:source-corpus-admission" };${MAP_END.slice(2)}`, SERVER)],
  },
  "the map entry path declares a different action": {
    edits: [edit(`path: "plan/_journeys/create-world-pack.yaml"`, `path: "plan/_journeys/play-world-scenario.yaml"`, SERVER)],
  },
  "the map entry path does not exist": {
    edits: [edit(`path: "plan/_journeys/create-world-pack.yaml"`, `path: "plan/_journeys/missing.yaml"`, SERVER)],
  },
  "the map entry path escapes the repository": {
    edits: [edit(`path: "plan/_journeys/create-world-pack.yaml"`, `path: "../outside/create-world-pack.yaml"`, SERVER)],
  },
  "the executed action differs from the mapped key": {
    edits: [edit("action: ACTION,", `action: "create_scenario",`)],
  },
  "the executed action is dynamic": {
    edits: [edit("action: ACTION,", `action: String(process.argv[2]),`)],
  },
  "the request carries no action": { edits: [edit("    action: ACTION,\n", "")] },
  "the request spreads an object that can override the action": {
    edits: [edit("action: ACTION,", "action: ACTION,\n    ...(runtime as Record<string, never>),")],
  },
  "the request is built outside the call": {
    edits: [edit("const result = await journey.execute(" + entryRequest + ", {", "const request = " + entryRequest + ";\n  const result = await journey.execute(request, {")],
  },
  "the execution is not awaited": { edits: [edit("await journey.execute(", "journey.execute(")] },
  "the result is never asserted": { edits: [edit("expect(result.journey?.interlockings)", "void result;\n  expect(context)")] },
  "the assertion is on a mapped field, not the result": { edits: [edit("expect(result.journey?.interlockings)", "void result;\n  expect(entry.interlockingId)")] },
  "the result is not the awaited const": { edits: [edit("expect(result.journey?.interlockings)", "void result;\n  expect(runtime.clock)")] },
  "a stub JourneyRunner declared in the test": {
    edits: [edit(`import { JourneyRunner } from "../../src/trains/journey.ts";`, `class JourneyRunner {\n  constructor(readonly path: string, readonly runtime: unknown) {}\n  async execute(..._args: unknown[]) { return { journey: { interlockings: ["interlocking:source-corpus-admission"] } }; }\n}`)],
  },
  "the test patches JourneyRunner.prototype.execute": {
    edits: [edit(`const runtime = { clock: "fixed" };`, `const runtime = { clock: "fixed" };\nJourneyRunner.prototype.execute = async function () { return { journey: { interlockings: ["interlocking:source-corpus-admission"] } } as any; };`)],
  },
  "a non-production JourneyRunner stub module": {
    edits: [edit(`"../../src/trains/journey.ts"`, `"../support/journey-stub.ts"`)],
    extra: {
      "e2e/support/journey-stub.ts": `export class JourneyRunner {\n  constructor(readonly path: string, readonly runtime: unknown) {}\n  async execute(..._args: unknown[]) { return { journey: { interlockings: ["interlocking:source-corpus-admission"] } }; }\n}\n`,
    },
  },
  "the production JourneyRunner skips the InterlockingRunner": {
    edits: [edit(
      "const run = await new InterlockingRunner(path).execute(action, inputs, seed, context.handlers);",
      `void path;\n      const run = { resolution: { interlockingId: current, routeId: "refuse" }, executed: { selectedTrainId: "train:source:refuse", terminal: { artifact: "x", value: null }, wagons: [] as string[] } };`,
      JOURNEY_RUNNER,
    )],
  },
  "the mapped module patches JourneyRunner.prototype.execute": {
    edits: [edit(MAP_END, `${MAP_END.slice(0, 2)}\n\nJourneyRunner.prototype.execute = async function () { return {} as any; };${MAP_END.slice(2)}`, SERVER)],
  },
};

for (const [name, { text, edits, extra }] of Object.entries(negatives)) {
  test(`production-runner-used still fires for the object-form JourneyEntry: ${name}`, async () => {
    expect(await findings(text ?? base, edits, extra)).toContain(JOURNEY_TEST);
  });
}

// Review F1: an imported JOURNEY_MAP is only static if no module of the test's local import closure can rewrite it.
const SUPPORT = "e2e/support/patch-map.ts";
const SERVER_SPEC = `"../../src/server.ts"`;
const REWRITE = `"plan/_journeys/play-world-scenario.yaml"`;
const withSupport = (source: string, ...more: Array<[string, string]>) => ({
  edits: [edit(`import { JourneyRunner }`, `import "../support/patch-map.ts";\nimport { JourneyRunner }`)],
  extra: { [SUPPORT]: source, ...Object.fromEntries(more) },
});

const closurePositives: Record<string, { edits: Edit[]; extra: Record<string, string> }> = {
  "a sibling support module only reads the imported map": withSupport(
    `import { JOURNEY_MAP } from ${SERVER_SPEC};\nexport const declared = JOURNEY_MAP.create_world.path;\nexport const keys = Object.keys(JOURNEY_MAP);\n`,
  ),
  "a sibling support module only reads the map through a namespace": withSupport(
    `import * as station from ${SERVER_SPEC};\nexport const declared = station.JOURNEY_MAP.create_world.path;\nexport const run = station.executeAction;\n`,
  ),
};

for (const [name, { edits, extra }] of Object.entries(closurePositives)) {
  test(`production-runner-used accepts the object-form JourneyEntry: ${name}`, async () => {
    expect(await findings(base, edits, extra)).toEqual([]);
  });
}

const closureNegatives: Record<string, { edits: Edit[]; extra: Record<string, string> }> = {
  "a side-effect module assigns a named-imported map entry path": withSupport(
    `import { JOURNEY_MAP } from ${SERVER_SPEC};\n(JOURNEY_MAP as any).create_world.path = ${REWRITE};\n`,
  ),
  "a side-effect module assigns through a renamed named import": withSupport(
    `import { JOURNEY_MAP as MAP } from ${SERVER_SPEC};\n(MAP as any).create_world.path = ${REWRITE};\n`,
  ),
  "a side-effect module assigns through a namespace import": withSupport(
    `import * as station from ${SERVER_SPEC};\n(station.JOURNEY_MAP as any).create_world.path = ${REWRITE};\n`,
  ),
  "a side-effect module uses Object.assign on a named-imported entry": withSupport(
    `import { JOURNEY_MAP } from ${SERVER_SPEC};\nObject.assign(JOURNEY_MAP.create_world, { path: ${REWRITE} });\n`,
  ),
  "a side-effect module uses Object.assign on a namespace-imported entry": withSupport(
    `import * as station from ${SERVER_SPEC};\nObject.assign(station.JOURNEY_MAP.create_world, { path: ${REWRITE} });\n`,
  ),
  "a side-effect module uses Object.assign on the namespace-imported map": withSupport(
    `import * as station from ${SERVER_SPEC};\nObject.assign(station.JOURNEY_MAP, { create_world: { path: ${REWRITE} } });\n`,
  ),
  "a side-effect module aliases the namespace before writing": withSupport(
    `import * as station from ${SERVER_SPEC};\nconst alias = station as any;\nalias.JOURNEY_MAP.create_world.path = ${REWRITE};\n`,
  ),
  "a side-effect module destructures the map out of the namespace": withSupport(
    `import * as station from ${SERVER_SPEC};\nconst { JOURNEY_MAP: map } = station;\n(map as any).create_world.path = ${REWRITE};\n`,
  ),
  "a side-effect module reads the namespace map by element access": withSupport(
    `import * as station from ${SERVER_SPEC};\n(station as any)["JOURNEY_MAP"].create_world.path = ${REWRITE};\n`,
  ),
  "a side-effect module reaches the map by dynamic import": withSupport(
    `const station = await import(${SERVER_SPEC});\n(station.JOURNEY_MAP as any).create_world.path = ${REWRITE};\n`,
  ),
  "a side-effect module reaches the map by require": withSupport(
    `const station = require(${SERVER_SPEC});\nstation.JOURNEY_MAP.create_world.path = ${REWRITE};\n`,
  ),
  "a side-effect module re-exports the map for a later writer": withSupport(
    `export { JOURNEY_MAP } from ${SERVER_SPEC};\n`,
  ),
  "a side-effect module star re-exports the map module": withSupport(
    `export * from ${SERVER_SPEC};\n`,
  ),
  "a side-effect module deletes a map entry": withSupport(
    `import { JOURNEY_MAP } from ${SERVER_SPEC};\ndelete (JOURNEY_MAP as any).create_world;\n`,
  ),
  "the writer is only transitively imported by the test": withSupport(
    `import "./deep-patch.ts";\n`,
    [`e2e/support/deep-patch.ts`, `import { JOURNEY_MAP } from ${SERVER_SPEC};\n(JOURNEY_MAP as any).create_world.path = ${REWRITE};\n`],
  ),
  "the writer is imported through a relative index module": withSupport(
    `import "./deep/index.ts";\n`,
    [`e2e/support/deep/index.ts`, `import { JOURNEY_MAP } from "../../../src/server.ts";\nObject.assign(JOURNEY_MAP.create_world, { path: ${REWRITE} });\n`],
  ),
  "the test itself aliases the namespace before writing": {
    edits: [edit(`const runtime = { clock: "fixed" };`, `const runtime = { clock: "fixed" };\nconst alias = stationMaster as any;\nalias.JOURNEY_MAP.create_world.path = ${REWRITE};`)],
    extra: {},
  },
  "the test itself destructures the map out of the namespace": {
    edits: [edit(`const runtime = { clock: "fixed" };`, `const runtime = { clock: "fixed" };\nconst { JOURNEY_MAP: map } = stationMaster;\n(map as any).create_world.path = ${REWRITE};`)],
    extra: {},
  },
};

for (const [name, { edits, extra }] of Object.entries(closureNegatives)) {
  test(`production-runner-used still fires for the object-form JourneyEntry: ${name}`, async () => {
    expect(await findings(base, edits, extra)).toContain(JOURNEY_TEST);
  });
}
