import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runImplementation } from "../src/enforce";

const fixtures = resolve(import.meta.dir, "../detectors/bun_interlocking_coverage/fixtures");
const positive = join(fixtures, "clean", "journey_mediated_train_path_runner");
const SMOKE = "tester.bun.interlocking-smoke-coverage-for-station-master";
const run = (root: string) => runImplementation("bun_interlocking_coverage", {
  scanRoots: [root], excludes: ["node_modules", ".git", ".atdd"],
});
const smoke = (findings: Awaited<ReturnType<typeof run>>) => findings.filter(finding => finding.rule_id === SMOKE);

// Each mutant is the persisted positive fixture with exactly one file replaced, so a smoke finding can
// only come from that file's defect, never from an unrelated gap elsewhere in the corpus.
async function mutant(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "atdd-journey-runner-mutant-"));
  await cp(positive, root, { recursive: true });
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const interlocking = (body: string, extra = "") => `import { TrainRunner } from "./runner";

export class InterlockingRunner {
  constructor(private readonly interlockingPath: string) {}
  resolveTrain(_action: string, _inputs: object) {
    return { routeId: "nominal", trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" };
  }
  execute(action: string, inputs: object, context: { handlers: object; seed: object }) {
${body}
  }${extra}
}
`;

const server = (imports: string, body: string) => `${imports}

export const JOURNEY_MAP = {
  resolve_match: { journeyId: "journey:match", path: "plan/_journeys/match.yaml" },
};

export function dispatch(action: keyof typeof JOURNEY_MAP, inputs: object, context: { handlers: object; seed: object }) {
  const mapping = JOURNEY_MAP[action];
${body}
}
`;
const journeyReturn = "  return new JourneyRunner(mapping.path).execute(action, inputs, context);";
const journeySource = `import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  constructor(private readonly journeyPath: string) {}
  execute(action: string, inputs: object, context: { handlers: object; seed: object }) {
    return new InterlockingRunner(this.journeyPath).execute(action, inputs, context);
  }
}
`;

test("exported dispatch -> JourneyRunner -> InterlockingRunner -> TrainRunner(resolution.trainPath, handlers).execute(resolution, seed) is accepted", async () => {
  expect(await run(positive)).toEqual([]);
});

test("the persisted positive also clears when execute arguments span lines and are awaited", async () => {
  expect(await mutant({
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    return await new TrainRunner(resolution.trainPath, context.handlers).execute(
      resolution,
      context.seed,
    );`).replace("  execute(action", "  async execute(action"),
  })).toEqual([]);
});

test("the persisted positive also clears when InterlockingRunner returns the execution inside a frozen record", async () => {
  for (const record of ["resolution: resolution", "resolution"]) {
    expect(await mutant({
      "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    return Object.freeze({
      ${record},
      executed: await new TrainRunner(resolution.trainPath, context.handlers).execute(
        resolution,
        context.seed,
      ),
    });`).replace("  execute(action", "  async execute(action"),
    }), record).toEqual([]);
  }
});

const trainPathMutants: Record<string, string> = {
  "fabricated path object": `    const resolution = this.resolveTrain(action, inputs);
    const fabricated = { trainPath: "plan/_trains/train:match:nominal.yaml" };
    return new TrainRunner(fabricated.trainPath, context.handlers).execute(resolution, context.seed);`,
  "literal path": `    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner("plan/_trains/train:match:nominal.yaml", context.handlers).execute(resolution, context.seed);`,
  "execute receives resolution.trainId": `    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution.trainId, context.seed);`,
  "execute receives resolution.selectedTrainId": `    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution.selectedTrainId, context.seed);`,
  "execute receives a fabricated object": `    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute({ trainId: "train:match:nominal" }, context.seed);`,
  "execute receives an unrelated resolution": `    const resolution = this.resolveTrain(action, inputs);
    const other = { trainId: "train:match:nominal", trainPath: resolution.trainPath };
    return new TrainRunner(resolution.trainPath, context.handlers).execute(other, context.seed);`,
  "path property reassigned before construction": `    const resolution = this.resolveTrain(action, inputs);
    resolution.trainPath = "plan/_trains/train:unrelated.yaml";
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
  "resolution variable reassigned before construction": `    let resolution = this.resolveTrain(action, inputs);
    resolution = { ...resolution, trainPath: "plan/_trains/train:unrelated.yaml" };
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
  "assigned execution discarded for business data": `    const resolution = this.resolveTrain(action, inputs);
    const executed = new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
    void executed;
    return { selectedTrainId: "train:match:nominal" };`,
  "resolution aliased and mutated before construction": `    const resolution = this.resolveTrain(action, inputs);
    const alias = resolution;
    alias.trainPath = "plan/_trains/train:unrelated.yaml";
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
  "resolveTrain on an unrecognized receiver": `    const fake = { resolveTrain: (_a: string, _i: object) => ({ trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" }) };
    const resolution = fake.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
};

for (const [name, body] of Object.entries(trainPathMutants)) {
  test(`declaration-path proof rejects ${name}`, async () => {
    expect(smoke(await mutant({ "src/trains/interlocking.ts": interlocking(body) }))).not.toEqual([]);
  });
}

test("declaration-path proof rejects a same-name resolution fabricated in a different scope", async () => {
  expect(smoke(await mutant({
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    void resolution;
    return this.fabricated(context);`, `
  fabricated(context: { handlers: object; seed: object }) {
    const resolution = { trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" };
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  }`),
  }))).not.toEqual([]);
});

// Independent review of 5d2e794 (pullrequestreview-5479008187): four single-file mutants that cleared
// smoke. Each is persisted verbatim and must fail for its named gap.
const reviewMutants: Record<string, Record<string, string>> = {
  "A: InterlockingRunner discards the TrainRunner execution and returns business data": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
    return { selectedTrainId: "train:match:nominal" };`),
  },
  "B: a same-name resolution parameter in another method executes a fabricated path": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    void resolution;
    return this.run({ trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" }, context);`, `
  run(resolution: { trainId: string; trainPath: string }, context: { handlers: object; seed: object }) {
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  }`),
  },
  "C: JourneyRunner.execute returns business data beside an uncalled traversal": {
    "src/trains/journey.ts": `import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  constructor(private readonly journeyPath: string) {}
  execute(_action: string, _inputs: object, _context: { handlers: object; seed: object }) {
    return { selectedTrainId: "train:match:nominal" };
  }
  unused(action: string, inputs: object, context: { handlers: object; seed: object }) {
    return new InterlockingRunner(this.journeyPath).execute(action, inputs, context);
  }
}
`,
  },
  "D: Object.assign rebinds resolution.trainPath before construction": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    Object.assign(resolution, { trainPath: "plan/_trains/train:unrelated.yaml" });
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`),
  },
};

for (const [name, files] of Object.entries(reviewMutants)) {
  test(`journey-mediated proof rejects review mutant ${name}`, async () => {
    expect(smoke(await mutant(files))).not.toEqual([]);
  });
}

// Fresh re-review of ea40607 (pullrequestreview-5479058044): further single-file false greens E1-E5,
// each persisted verbatim and required to fail for its named gap.
const interlockingClass = (methods: string) => `import { TrainRunner } from "./runner";

export class InterlockingRunner {
  constructor(private readonly interlockingPath: string) {}
  resolveTrain(_action: string, _inputs: object) {
    return { routeId: "nominal", trainId: "train:match:nominal", trainPath: "plan/_trains/train:match:nominal.yaml" };
  }
${methods}
}
`;
const reReviewMutants: Record<string, Record<string, string>> = {
  "E1: resolution aliased through an object shorthand value, then mutated": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    const holder = { resolution };
    holder.resolution.trainPath = "plan/_trains/train:unrelated.yaml";
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`),
  },
  "E1: resolution aliased through a keyed object value, then mutated": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    const holder = { r: resolution };
    holder.r.trainPath = "plan/_trains/train:unrelated.yaml";
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`),
  },
  "E2: invoked InterlockingRunner.execute returns business data beside an uncalled traversal": {
    "src/trains/interlocking.ts": interlockingClass(`  execute(_action: string, _inputs: object, _context: { handlers: object; seed: object }) {
    return { selectedTrainId: "train:match:nominal" };
  }
  real(action: string, inputs: object, context: { handlers: object; seed: object }) {
    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
  }`),
  },
  "E3: legacy trainId form escapes the declaring scope through a same-name parameter": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    void resolution;
    return this.run({ trainId: "train:match:nominal" }, context);`, `
  run(resolution: { trainId: string }, context: { handlers: object; seed: object }) {
    return new TrainRunner(resolution.trainId).execute(context.seed);
  }`),
  },
  "E4: braceless dead branch returns the execution": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    if (false) return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
    return { selectedTrainId: "train:match:nominal" };`),
  },
  "E5: comma expression discards the execution": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    return (new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed), { selectedTrainId: "train:match:nominal" });`),
  },
  "E5 sibling: ternary returns the execution only on a dead branch": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    return false ? new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed) : { selectedTrainId: "train:match:nominal" };`),
  },
  "E5 sibling: logical operator returns business data after the execution": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed) && { selectedTrainId: "train:match:nominal" };`),
  },
};

for (const [name, files] of Object.entries(reReviewMutants)) {
  test(`journey-mediated proof rejects re-review mutant ${name}`, async () => {
    expect(smoke(await mutant(files))).not.toEqual([]);
  });
}

// Legitimate shapes the stricter binding must keep accepting (re-review false reds R1, R2, R4a, R4b).
const reReviewPositives: Record<string, string> = {
  "R1: resolution logged before execution": `    const resolution = this.resolveTrain(action, inputs);
    console.log(resolution);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
  "R2: trainPath member chain read before execution": `    const resolution = this.resolveTrain(action, inputs);
    if (!resolution.trainPath.length) throw new Error("declaration has no train path");
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
  "R4a: inline object type annotation on the resolution": `    const resolution: { trainId: string; trainPath: string } = this.resolveTrain(action, inputs);
    return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);`,
  "R4b: execution returned inside try": `    const resolution = this.resolveTrain(action, inputs);
    try {
      return new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed);
    } finally {
      void action;
    }`,
};

for (const [name, body] of Object.entries(reReviewPositives)) {
  test(`journey-mediated proof accepts ${name}`, async () => {
    expect(await mutant({ "src/trains/interlocking.ts": interlocking(body) })).toEqual([]);
  });
}

// Third review of 57e8c73 (pullrequestreview-5479107545): dead-expression and skipped-operand false greens.
const exec = "new TrainRunner(resolution.trainPath, context.handlers).execute(resolution, context.seed)";
const business = `{ selectedTrainId: "train:match:nominal" }`;
const deadJourney = (branch: string) => server(`import { JourneyRunner } from "./src/trains/journey";`, `  ${branch}
  return ${business};`);
const thirdReviewMutants: Record<string, Record<string, string>> = {
  "E8: dispatch returns the JourneyRunner execution only inside a braced dead branch": {
    "server.ts": deadJourney("if (false) { return new JourneyRunner(mapping.path).execute(action, inputs, context); }"),
  },
  "E8b: dispatch returns the JourneyRunner execution only inside a braceless dead branch": {
    "server.ts": deadJourney("if (false) return new JourneyRunner(mapping.path).execute(action, inputs, context);"),
  },
  "E6: execution after an unconditional top-level business return": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    return ${business};
    return ${exec};`),
  },
  "E4b: block comment separates the dead if from its return": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    if (false) /* dead */ return ${exec};
    return ${business};`),
  },
  "E4c: line comment separates the dead if from its return": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    if (false) // dead
      return ${exec};
    return ${business};`),
  },
  "E7: void discards the returned execution": {
    "src/trains/interlocking.ts": interlocking(`    const resolution = this.resolveTrain(action, inputs);
    return void ${exec};`),
  },
};

for (const [name, files] of Object.entries(thirdReviewMutants)) {
  test(`journey-mediated proof rejects third-review mutant ${name}`, async () => {
    expect(smoke(await mutant(files))).not.toEqual([]);
  });
}

const thirdReviewPositives: Record<string, string> = {
  "R5: try/catch that rethrows": `    const resolution = this.resolveTrain(action, inputs);
    try {
      return ${exec};
    } catch (error) {
      throw error;
    }`,
  "R6: early guard throw before execution": `    const resolution = this.resolveTrain(action, inputs);
    if (!resolution.trainPath) throw new Error("declaration has no train path");
    return ${exec};`,
  "R7: returned record with an unrelated ternary value": `    const resolution = this.resolveTrain(action, inputs);
    return Object.freeze({ executed: ${exec}, mode: action ? "declared" : "default" });`,
  "R8: grouped return": `    const resolution = this.resolveTrain(action, inputs);
    return (${exec});`,
};

for (const [name, body] of Object.entries(thirdReviewPositives)) {
  test(`journey-mediated proof accepts ${name}`, async () => {
    expect(await mutant({ "src/trains/interlocking.ts": interlocking(body) })).toEqual([]);
  });
}

const journeyMutants: Record<string, Record<string, string>> = {
  "dispatch returning business data directly": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/journey";`, `  void JourneyRunner; void mapping; void inputs; void context;
  return { selectedTrainId: "train:match:nominal" };`),
  },
  "dispatch constructing an inert JourneyRunner": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/journey";`, `  const journey = new JourneyRunner(mapping.path);
  journey.execute(action, inputs, context);
  return { selectedTrainId: "train:match:nominal" };`),
  },
  "JourneyRunner that never reaches InterlockingRunner": {
    "src/trains/journey.ts": `import { InterlockingRunner } from "./interlocking";

export class JourneyRunner {
  constructor(private readonly journeyPath: string) {}
  execute(_action: string, _inputs: object, _context: object) {
    void InterlockingRunner;
    return { selectedTrainId: "train:match:nominal" };
  }
}
`,
  },
  "JourneyRunner imported from a test-local module": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/journey.test";`, journeyReturn),
    "src/trains/journey.test.ts": journeySource,
  },
  "JourneyRunner imported from a spec-local module": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/journey.spec";`, journeyReturn),
    "src/trains/journey.spec.ts": journeySource,
  },
  "JourneyRunner imported from an unresolved module": {
    "server.ts": server(`import { JourneyRunner } from "./src/trains/missing-journey";`, journeyReturn),
  },
  "JourneyRunner imported from an external package": {
    "server.ts": server(`import { JourneyRunner } from "@consumer/journey";`, journeyReturn),
  },
};

for (const [name, files] of Object.entries(journeyMutants)) {
  test(`journey-mediated proof rejects ${name}`, async () => {
    expect(smoke(await mutant(files))).not.toEqual([]);
  });
}

// The dirty corpus is scanned as one root, where any fixture's gap keeps it non-empty. Each persisted
// journey fixture must instead fail on its own, and repairing only its named defect must clear it.
const dirtyJourneyRepairs: Record<string, (root: string) => Promise<void>> = {
  journey_mediated_direct_business: root => cp(join(positive, "server.ts"), join(root, "server.ts")),
  journey_test_local_lookalike: async root => {
    await cp(join(positive, "src", "trains", "journey.ts"), join(root, "src", "trains", "journey.ts"));
    await cp(join(positive, "server.ts"), join(root, "server.ts"));
  },
};

for (const [fixture, repair] of Object.entries(dirtyJourneyRepairs)) {
  test(`persisted dirty ${fixture} fails only for its named defect`, async () => {
    expect(smoke(await run(join(fixtures, "dirty", fixture)))).not.toEqual([]);
    const root = await mkdtemp(join(tmpdir(), "atdd-journey-dirty-repair-"));
    try {
      await cp(join(fixtures, "dirty", fixture), root, { recursive: true });
      await repair(root);
      expect(await run(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
