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

// Review #5 of 39ddad3 (pullrequestreview-5479393099): overrides the chain's own contract excludes
// ("no field, accessor, duplicate, constructor or prototype assignment"). Each is one edit to the
// production fixture and must be rejected by both interlocking families.
const fakeInterlocked = `{ resolution: {}, executed: { selectedTrainId: "train:source:refuse", terminal: { artifact: "x", value: null }, wagons: [] } }`;
const fakeJourney = `{ selectedTrainId: "train:source:refuse", terminal: { artifact: "x", value: null }, wagons: [], journey: {} }`;
const append = (tail: string) => (_path: string, text: string) => `${text}\n${tail}\n`;
const overrides: Record<string, { file: string; edit: (path: string, text: string) => string }> = {
  "P7: InterlockingRunner constructor returns a different object": {
    file: "src/trains/interlocking.ts",
    edit: replace("constructor(private readonly interlockingYamlPath: string) {}",
      `constructor(private readonly interlockingYamlPath: string) {\n    return { execute: async () => (${fakeInterlocked}) } as any;\n  }`),
  },
  "P7b: JourneyRunner constructor returns a different object": {
    file: "src/trains/journey.ts",
    edit: replace("constructor(private readonly journeyYamlPath: string) {}",
      `constructor(private readonly journeyYamlPath: string) {\n    return { execute: async () => (${fakeJourney}) } as any;\n  }`),
  },
  "P2: aliased InterlockingRunner prototype reassigns execute": {
    file: "src/trains/interlocking.ts",
    edit: append(`const proto = InterlockingRunner.prototype as any;\nproto.execute = async () => (${fakeInterlocked});`),
  },
  "P2b: Reflect.set replaces InterlockingRunner.prototype.execute": {
    file: "src/trains/interlocking.ts",
    edit: append(`Reflect.set(InterlockingRunner.prototype, "execute", async () => (${fakeInterlocked}));`),
  },
  "P6: cast this assigns execute in the InterlockingRunner constructor": {
    file: "src/trains/interlocking.ts",
    edit: replace("constructor(private readonly interlockingYamlPath: string) {}",
      `constructor(private readonly interlockingYamlPath: string) {\n    (this as any).execute = async () => (${fakeInterlocked});\n  }`),
  },
  "P1b: Station Master patches JourneyRunner.prototype.execute": {
    file: "src/server.ts",
    edit: append(`JourneyRunner.prototype.execute = async function () { return (${fakeJourney}) as any; };`),
  },
  "Reflect.set on this assigns execute in the constructor": {
    file: "src/trains/interlocking.ts",
    edit: replace("constructor(private readonly interlockingYamlPath: string) {}",
      `constructor(private readonly interlockingYamlPath: string) {\n    Reflect.set(this, "execute", async () => (${fakeInterlocked}));\n  }`),
  },
  "Object.defineProperty on this defines execute in the constructor": {
    file: "src/trains/interlocking.ts",
    edit: replace("constructor(private readonly interlockingYamlPath: string) {}",
      `constructor(private readonly interlockingYamlPath: string) {\n    Object.defineProperty(this, "execute", { value: async () => (${fakeInterlocked}) });\n  }`),
  },
  "JourneyRunner module assigns execute on an InterlockingRunner instance": {
    file: "src/trains/journey.ts",
    edit: replace("      const run = await new InterlockingRunner(path).execute(",
      `      const runner = new InterlockingRunner(path);\n      (runner as any)["execute"] = async () => (${fakeInterlocked});\n      const run = await new InterlockingRunner(path).execute(`),
  },
  "static block patches the InterlockingRunner prototype": {
    file: "src/trains/interlocking.ts",
    edit: replace("constructor(private readonly interlockingYamlPath: string) {}",
      `static { (this as any).prototype.execute = async () => (${fakeInterlocked}); }\n  constructor(private readonly interlockingYamlPath: string) {}`),
  },
  "TrainRunner module patches its own prototype": {
    file: "src/trains/runner.ts",
    edit: append(`(TrainRunner as any).prototype.execute = async () => ({});`),
  },
  "computed key reaches the InterlockingRunner prototype": {
    file: "src/trains/interlocking.ts",
    edit: append(`const key = "exec" + "ute";\n(InterlockingRunner as any)["proto" + "type"][key] = async () => (${fakeInterlocked});`),
  },
};

for (const [name, { file, edit }] of Object.entries(overrides)) {
  test(`production-shape proof rejects override ${name}`, async () => {
    const found = ruleIds(await mutant(edit, file));
    for (const rule of [SMOKE, STATION, JOURNEY]) expect(found, rule).toContain(rule);
  });
}

// Review #6 of 870b4f3 (pullrequestreview-5479511646): decorators and an aliased prototype with a
// variable key, each one edit to the production fixture.
const reviewSix: Record<string, { file: string; edit: (path: string, text: string) => string }> = {
  "Q2: class decorator replaces InterlockingRunner": {
    file: "src/trains/interlocking.ts",
    edit: replace("export class InterlockingRunner {",
      `function swap(_target: unknown): any {\n  return class { async execute() { return ${fakeInterlocked}; } async resolveTrain() { return {}; } };\n}\n\n@swap\nexport class InterlockingRunner {`),
  },
  "Q2b: method decorator replaces InterlockingRunner.execute": {
    file: "src/trains/interlocking.ts",
    edit: replace("  /** Selects exactly one declared train, then delegates its wagon execution. */\n  async execute(",
      `  /** Selects exactly one declared train, then delegates its wagon execution. */\n  @((_t: unknown, _k: string, d: PropertyDescriptor) => { d.value = async () => (${fakeInterlocked}); return d; })\n  async execute(`),
  },
  "Q1b: class alias and variable key reach the prototype through Reflect.set": {
    file: "src/trains/interlocking.ts",
    edit: append(`const R = InterlockingRunner;\nconst key = "execute";\nReflect.set(R.prototype, key, async () => (${fakeInterlocked}));`),
  },
};

for (const [name, { file, edit }] of Object.entries(reviewSix)) {
  test(`production-shape proof rejects ${name}`, async () => {
    const found = ruleIds(await mutant(edit, file));
    for (const rule of [SMOKE, STATION, JOURNEY]) expect(found, rule).toContain(rule);
  });
}

// Review #6 supplement (maintainer, M-20261010T151554Z): R-c is not an accepted residual. A local
// side-effect module imported by the Station Master that patches a runner prototype violates the
// guarantee, so override checks must cover the Station Master's transitive local imports.
test("production-shape proof rejects R-c: a side-effect module imported by the Station Master patches the prototype", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-station-side-effect-patch-"));
  try {
    await cp(fixture, root, { recursive: true });
    await writeFile(join(root, "src", "trains", "patch.ts"), `import { InterlockingRunner } from "./interlocking.ts";

(InterlockingRunner.prototype as any).execute = async () => (${fakeInterlocked});
`);
    const server = join(root, "src", "server.ts");
    await writeFile(server, `import "./trains/patch.ts";\n${await readFile(server, "utf8")}`);
    const found = ruleIds(await both(root));
    for (const rule of [SMOKE, STATION, JOURNEY]) expect(found, rule).toContain(rule);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Ordinary code that cannot change what the chain's freshly constructed runners execute stays accepted
// (review #6 FR examples, plus the consumer's read-only getPrototypeOf in an imported module).
const unrelatedWrites: Record<string, { file: string; edit: (path: string, text: string) => string }> = {
  "a dynamic-key write to a local map in JourneyRunner": {
    file: "src/trains/journey.ts",
    edit: replace("    const traversed = [] as string[];", "    const traversed = [] as string[];\n    const seen: Record<string, number> = {};\n    seen[action] = (seen[action] ?? 0) + 1;"),
  },
  "a dynamic-key counter write in the Station Master": {
    file: "src/server.ts",
    edit: append(`const counters: Record<string, number> = {};\nexport function count(name: string) { counters[name] = (counters[name] ?? 0) + 1; return counters[name]; }`),
  },
  "an unrelated object's execute assignment": {
    file: "src/server.ts",
    edit: append(`const job: { execute?: () => string } = {};\njob.execute = () => "unrelated";`),
  },
  "Object.assign onto application state": {
    file: "src/server.ts",
    edit: append(`const state: Record<string, unknown> = {};\nexport function patchState(patch: Record<string, unknown>) { return Object.assign(state, patch); }`),
  },
  "a read-only getPrototypeOf plain-object check in an imported module": {
    file: "src/trains/runner.ts",
    edit: append(`export const isPlain = (value: object) => { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; };`),
  },
};

for (const [name, { file, edit }] of Object.entries(unrelatedWrites)) {
  test(`production-shape proof still accepts ${name}`, async () => {
    expect(await mutant(edit, file)).toEqual([]);
  });
}

// Review #7 of 82bba1b (pullrequestreview-5479679404), S2: the Station Master reaches the patch through
// a tsconfig path alias that Bun honors at runtime, so the closure must resolve local aliases too.
test("production-shape proof rejects S2: a tsconfig path-aliased side-effect module patches the prototype", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-station-aliased-patch-"));
  try {
    await cp(fixture, root, { recursive: true });
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }, null, 2));
    await writeFile(join(root, "src", "patch.ts"), `import { InterlockingRunner } from "./trains/interlocking.ts";

(InterlockingRunner.prototype as any).execute = async () => (${fakeInterlocked});
`);
    const server = join(root, "src", "server.ts");
    await writeFile(server, `import "@/patch.ts";\n${await readFile(server, "utf8")}`);
    const found = ruleIds(await both(root));
    for (const rule of [SMOKE, STATION, JOURNEY]) expect(found, rule).toContain(rule);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Review #8 of 202f40e, S2-j: Bun also honors jsconfig.json `paths`, so the same aliased side-effect
// patch through jsconfig must be followed.
test("production-shape proof rejects S2-j: a jsconfig path-aliased side-effect module patches the prototype", async () => {
  const root = await mkdtemp(join(tmpdir(), "atdd-station-jsconfig-patch-"));
  try {
    await cp(fixture, root, { recursive: true });
    await writeFile(join(root, "jsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }, null, 2));
    await writeFile(join(root, "src", "patch.ts"), `import { InterlockingRunner } from "./trains/interlocking.ts";

(InterlockingRunner.prototype as any).execute = async () => (${fakeInterlocked});
`);
    const server = join(root, "src", "server.ts");
    await writeFile(server, `import "@/patch.ts";\n${await readFile(server, "utf8")}`);
    const found = ruleIds(await both(root));
    for (const rule of [SMOKE, STATION, JOURNEY]) expect(found, rule).toContain(rule);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
